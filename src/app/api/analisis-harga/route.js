import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { analisisHarga, ringkasFaktaUntukLlm, angkaTidakTerverifikasi } from '@/lib/forecast';
import { hitungSimulasi } from '@/lib/simulasi';

// Endpoint analisis harga (hanya admin).
//  1. Memverifikasi login + peran admin (token dari peramban, aturan RLS tetap berlaku).
//  2. Mengambil harga dari database, menghitung ramalan dan rekomendasi (kode, bukan LLM).
//  3. OPSIONAL: meminta LLM menjelaskan hasil. LLM hanya menerima angka hasil hitung dan
//     tidak boleh menambah angka baru; angka di luar fakta ditandai.
//  4. Mencatat pemakaian (ai_logs) dan membatasi jumlah panggilan LLM per hari.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEPUTUSAN = ['jual_sekarang', 'tunggu', 'jual_sebagian', 'data_kurang'];
const BATAS_HARIAN = Number(process.env.AI_DAILY_LIMIT || 20);

const SISTEM = `Kamu adalah asisten analisis harga kakao untuk pengurus koperasi tani di Lampung.
Kamu menerima JSON berisi hasil perhitungan (harga terakhir, ramalan beberapa minggu, uji akurasi, keputusan aturan).
ATURAN KETAT:
- Gunakan HANYA angka yang ada pada JSON. Jangan membuat angka, persentase, atau fakta pasar baru.
- Jangan menjanjikan harga. Sebut ketidakpastian, terutama jika uji akurasi lemah atau data sedikit.
- Jika "lebih_baik_dari_naif" bernilai false, jelaskan bahwa ramalan belum bisa diandalkan.
- Bahasa Indonesia sederhana untuk pengurus koperasi. Singkat dan konkret.
- Keputusan akhir ada pada pengurus; kamu hanya memberi pertimbangan.
Balas HANYA dengan satu objek JSON, tanpa teks lain, dengan bentuk:
{"keputusan":"jual_sekarang|tunggu|jual_sebagian|data_kurang","ringkasan":"1-2 kalimat","alasan":["maks 4 butir pendek"],"risiko":["maks 3 butir pendek"],"saran_tindakan":"1 kalimat"}`;

function ambilJson(teks) {
  const bersih = String(teks).replace(/```json|```/g, '').trim();
  const awal = bersih.indexOf('{');
  const akhir = bersih.lastIndexOf('}');
  if (awal < 0 || akhir <= awal) throw new Error('Jawaban LLM bukan JSON');
  return JSON.parse(bersih.slice(awal, akhir + 1));
}
const potong = (v, n) => String(v ?? '').slice(0, n);
const daftar = (v, maks, n) => (Array.isArray(v) ? v.slice(0, maks).map((x) => potong(x, n)) : []);

async function tanyaLlm(fakta) {
  const kunci = process.env.ANTHROPIC_API_KEY;
  if (!kunci) return { ok: false, tidakDipanggil: true, alasan: 'LLM belum dikonfigurasi (ANTHROPIC_API_KEY kosong); menampilkan hasil berbasis aturan.' };
  const pengendali = new AbortController();
  const timer = setTimeout(() => pengendali.abort(), 20000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': kunci, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'claude-haiku-5-5',
        max_tokens: 700,
        system: SISTEM,
        messages: [{ role: 'user', content: JSON.stringify(fakta) }],
      }),
      signal: pengendali.signal,
    });
    if (!res.ok) return { ok: false, alasan: `LLM menolak permintaan (HTTP ${res.status}).` };
    const data = await res.json();
    const teks = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const j = ambilJson(teks);
    const keputusan = KEPUTUSAN.includes(j.keputusan) ? j.keputusan : null;
    const hasil = {
      keputusan,
      ringkasan: potong(j.ringkasan, 400),
      alasan: daftar(j.alasan, 4, 220),
      risiko: daftar(j.risiko, 3, 220),
      saran_tindakan: potong(j.saran_tindakan, 240),
    };
    const semuaTeks = [hasil.ringkasan, ...hasil.alasan, ...hasil.risiko, hasil.saran_tindakan].join(' ');
    return { ok: true, hasil, angkaTakTerverifikasi: angkaTidakTerverifikasi(semuaTeks, fakta), model: data.model };
  } catch (e) {
    return { ok: false, alasan: e.name === 'AbortError' ? 'LLM terlalu lama merespons.' : 'LLM gagal diproses.' };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req) {
  const mulai = Date.now();
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ galat: 'Belum login.' }, { status: 401 });

  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: u, error: eu } = await supa.auth.getUser(token);
  if (eu || !u?.user) return NextResponse.json({ galat: 'Sesi tidak valid.' }, { status: 401 });
  const userId = u.user.id;

  const { data: profil } = await supa.from('profiles').select('role, is_active').eq('id', userId).single();
  if (!profil || profil.role !== 'admin' || !profil.is_active) {
    return NextResponse.json({ galat: 'Hanya admin yang boleh memakai fitur ini.' }, { status: 403 });
  }

  let body = {};
  try { body = await req.json(); } catch { /* body kosong diperbolehkan */ }
  const bolehLlm = body.pakaiLlm !== false;

  // ---- data dari database (RLS tetap berlaku) ----
  const [lokal, tujuan, panen] = await Promise.all([
    supa.from('price_entries').select('tanggal, harga_per_kg').eq('jenis', 'lokal').eq('kondisi', 'kering')
      .order('tanggal', { ascending: false }).limit(300),
    supa.from('price_entries').select('tanggal, harga_per_kg').eq('jenis', 'tujuan').eq('kondisi', 'kering')
      .order('tanggal', { ascending: false }).limit(1),
    supa.from('harvests').select('berat_kg'),
  ]);
  if (lokal.error) return NextResponse.json({ galat: 'Gagal membaca data harga.' }, { status: 500 });

  // ---- Simulasi Jual (opsional) untuk konteks ----
  let simulasi = null;
  const hargaTujuan = tujuan.data?.[0]?.harga_per_kg;
  const hargaLokalTerbaru = lokal.data?.[0]?.harga_per_kg;
  if (hargaTujuan && hargaLokalTerbaru && Number(body.ongkir) >= 0 && body.ongkir !== undefined) {
    const s = hitungSimulasi({
      berat: Number(body.berat) || 0, hargaTujuan, ongkir: body.ongkir,
      biayaLain: body.biayaLain, susutPersen: body.susutPersen, hargaLokal: hargaLokalTerbaru,
    });
    simulasi = { selisih_per_kg: Math.round(s.selisih), harga_bersih_tujuan: Math.round(s.hargaBersih) };
  }

  // ---- analisis (kode, tanpa LLM) ----
  const hasil = analisisHarga(lokal.data || [], { selisihKolektifPerKg: simulasi?.selisih_per_kg });
  const stokKg = (panen.data || []).reduce((a, r) => a + Number(r.berat_kg), 0);
  const fakta = ringkasFaktaUntukLlm(hasil, {
    stok_tercatat_kg: Math.round(stokKg),
    ...(simulasi ? { simulasi_jual: simulasi } : {}),
  });

  // ---- batas harian panggilan LLM ----
  let terpakai = 0;
  if (bolehLlm) {
    const awalHari = new Date(); awalHari.setUTCHours(0, 0, 0, 0);
    const { count } = await supa.from('ai_logs').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('mode', 'llm').gte('created_at', awalHari.toISOString());
    terpakai = count || 0;
  }

  let penjelasan = null, sumber = 'aturan', catatan = null;
  if (hasil.status !== 'ok') {
    catatan = 'Data belum cukup, jadi LLM tidak dipanggil.';
  } else if (!bolehLlm) {
    catatan = 'Penjelasan AI tidak diminta.';
  } else if (terpakai >= BATAS_HARIAN) {
    catatan = `Batas ${BATAS_HARIAN} penjelasan AI per hari tercapai. Menampilkan hasil berbasis aturan.`;
  } else {
    const r = await tanyaLlm(fakta);
    if (r.ok && r.hasil.keputusan) {
      penjelasan = {
        ...r.hasil,
        konsisten: r.hasil.keputusan === hasil.keputusan,
        angkaTakTerverifikasi: r.angkaTakTerverifikasi,
        model: r.model,
      };
      sumber = 'llm';
    } else {
      catatan = r.ok ? 'Jawaban LLM tidak valid.' : r.alasan;
    }
    // catat penggunaan hanya bila LLM benar-benar dipanggil (gagal mencatat tidak menggagalkan respons)
    if (!r.tidakDipanggil) {
      await supa.from('ai_logs').insert({ user_id: userId, mode: 'llm', ok: sumber === 'llm', ms: Date.now() - mulai }).then(() => {}, () => {});
      terpakai += 1;
    }
  }

  return NextResponse.json({
    sumber, catatan, penjelasan,
    keputusan_aturan: hasil.keputusan,
    alasan_aturan: hasil.alasan,
    fakta,
    batas_harian: { terpakai, batas: BATAS_HARIAN },
  });
}
