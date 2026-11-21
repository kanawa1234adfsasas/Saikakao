'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { rupiah, tgl } from '@/lib/format';
import { analisisHarga, PARAM } from '@/lib/forecast';
import { simpanCache, bacaCache } from '@/lib/offlineCache';

const NAMA_KEPUTUSAN = {
  jual_sekarang: 'Jual sekarang',
  tunggu: 'Tunggu (tren naik)',
  jual_sebagian: 'Jual sebagian',
  data_kurang: 'Data belum cukup',
};
const KUNCI_CACHE = 'analisis:harga-lokal';

// ---------- grafik riwayat + ramalan ----------
function GrafikRamalan({ minggu, ramalan }) {
  const W = 640, H = 270, P = { l: 70, r: 16, t: 16, b: 40 };
  const riwayat = minggu.slice(-30);
  const semua = [...riwayat.map((m) => m.nilai), ...ramalan.flatMap((r) => [r.bawah, r.atas])];
  let min = Math.min(...semua), max = Math.max(...semua);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.1; min -= pad; max += pad;
  const total = riwayat.length + ramalan.length;
  const x = (i) => P.l + (i / Math.max(1, total - 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const n = riwayat.length;
  const garisRiwayat = riwayat.map((m, i) => `${x(i)},${y(m.nilai)}`).join(' ');
  const titikRamalan = [{ nilai: riwayat[n - 1].nilai }, ...ramalan].map((r, i) => `${x(n - 1 + i)},${y(r.nilai)}`).join(' ');
  const atas = ramalan.map((r, i) => `${x(n + i)},${y(r.atas)}`);
  const bawah = ramalan.map((r, i) => `${x(n + i)},${y(r.bawah)}`).reverse();
  const pita = `${x(n - 1)},${y(riwayat[n - 1].nilai)} ${atas.join(' ')} ${bawah.join(' ')}`;
  const ticks = [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Grafik riwayat harga dan ramalan beberapa minggu ke depan" style={{ width: '100%', height: 'auto' }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="#E3D5C4" />
            <text x={P.l - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill="#6B5B4E">{rupiah(t).replace('Rp', '').trim()}</text>
          </g>
        ))}
        <polygon points={pita} fill="#2E7D32" opacity="0.15" />
        <polyline points={garisRiwayat} fill="none" stroke="#B5651D" strokeWidth="2.5" />
        <polyline points={titikRamalan} fill="none" stroke="#2E7D32" strokeWidth="2.5" strokeDasharray="6 4" />
        <text x={P.l} y={H - 12} fontSize="11" fill="#6B5B4E">{tgl(riwayat[0].tanggal)}</text>
        <text x={W - P.r} y={H - 12} fontSize="11" textAnchor="end" fill="#6B5B4E">{tgl(ramalan[ramalan.length - 1].tanggal)}</text>
      </svg>
      <div className="legend" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '.9rem' }}>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: '#B5651D', marginRight: 6 }} />Harga lokal (rata-rata mingguan)</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: '#2E7D32', marginRight: 6 }} />Ramalan dan selang sekitar 80%</span>
      </div>
    </div>
  );
}

export default function AnalisisPage() {
  const [entries, setEntries] = useState([]);
  const [info, setInfo] = useState('');
  const [msg, setMsg] = useState('');
  const [online, setOnline] = useState(true);
  const [sim, setSim] = useState({ berat: '', ongkir: '', biayaLain: '', susutPersen: '2' });
  const [ai, setAi] = useState(null);
  const [memuat, setMemuat] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    async function muat() {
      const { data, error } = await supabase
        .from('price_entries').select('tanggal, harga_per_kg')
        .eq('jenis', 'lokal').eq('kondisi', 'kering').order('tanggal', { ascending: false }).limit(300);
      if (!error && data) { setEntries(data); simpanCache(KUNCI_CACHE, data); setInfo(''); return; }
      const c = bacaCache(KUNCI_CACHE);
      if (c) { setEntries(c.data); setInfo(`Menampilkan data tersimpan terakhir (${new Date(c.t).toLocaleString('id-ID')}) karena data terbaru tidak dapat diambil.`); }
      else setMsg('Data harga tidak dapat diambil dan belum ada data tersimpan di perangkat ini.');
    }
    muat();
  }, []);

  // ramalan dihitung di perangkat: tetap jalan saat offline
  const hasil = useMemo(() => analisisHarga(entries), [entries]);
  const setS = (k) => (e) => setSim((p) => ({ ...p, [k]: e.target.value }));

  async function mintaPenjelasan() {
    setMsg(''); setAi(null); setMemuat(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s?.session?.access_token;
      if (!token) { setMsg('Sesi berakhir, silakan masuk lagi.'); return; }
      const body = { pakaiLlm: true };
      if (sim.ongkir !== '') Object.assign(body, { ongkir: Number(sim.ongkir), berat: Number(sim.berat) || 0, biayaLain: Number(sim.biayaLain) || 0, susutPersen: Number(sim.susutPersen) || 0 });
      const res = await fetch('/api/analisis-harga', {
        method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.galat || 'Gagal meminta analisis.'); return; }
      setAi(j);
    } catch { setMsg('Tidak dapat menghubungi server. Periksa koneksi internet.'); }
    finally { setMemuat(false); }
  }

  const uji = hasil.uji;
  const kep = hasil.keputusan;

  return (
    <>
      <h1>Analisis Harga (AI)</h1>
      <p className="muted">
        Ramalan harga kakao kering lokal untuk {PARAM.CAKRAWALA} minggu ke depan dan rekomendasi waktu jual. Ramalan memakai statistika deret waktu
        yang dihitung di perangkat ini (tetap berjalan saat offline). Penjelasan oleh model bahasa (LLM) bersifat opsional dan memerlukan internet.
      </p>
      {info && <div className="alert info">{info}</div>}
      {msg && <div className="alert">{msg}</div>}

      <div className="card">
        <h3>Ramalan harga lokal</h3>
        {hasil.status !== 'ok' ? (
          <div className="alert info">
            Data harga mingguan belum cukup: baru {hasil.nAsli} minggu, minimal {PARAM.MIN_MINGGU} minggu. Tambahkan riwayat harga lokal (kakao kering) di menu Harga, lengkap dengan sumber dan tanggal.
          </div>
        ) : (
          <>
            <GrafikRamalan minggu={hasil.minggu} ramalan={hasil.ramalan} />
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Minggu</th><th>Tanggal</th><th>Ramalan (Rp/kg)</th><th>Selang ±80%</th></tr></thead>
                <tbody>
                  {hasil.ramalan.map((r) => (
                    <tr key={r.h}><td>+{r.h}</td><td>{tgl(r.tanggal)}</td><td>{rupiah(r.nilai)}</td><td>{rupiah(r.bawah)} - {rupiah(r.atas)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">
              Data: {hasil.nAsli} minggu asli{hasil.nInterpolasi > 0 ? `, ${hasil.nInterpolasi} minggu kosong diisi interpolasi` : ''}. Harga terakhir: {rupiah(hasil.terakhir)}.
            </p>
          </>
        )}
      </div>

      {hasil.status === 'ok' && uji && (
        <div className="card">
          <h3>Seberapa bisa dipercaya?</h3>
          <div className="grid cols-3">
            <div><div className="muted">Galat model (uji mundur)</div><div className="stat">{uji.mape?.toFixed(1)}%</div></div>
            <div><div className="muted">Galat tebakan naif</div><div className="stat">{uji.mapeNaif?.toFixed(1)}%</div></div>
            <div><div className="muted">Ketepatan arah naik/turun</div><div className="stat">{uji.akurasiArah === null ? '-' : `${Math.round(uji.akurasiArah)}%`}</div></div>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            Uji mundur: model dites meramal satu minggu ke depan berulang kali pada data yang sudah ada ({uji.nUji} kali). Tebakan naif berarti &quot;harga minggu depan sama dengan minggu ini&quot;.
            {uji.lebihBaikDariNaif
              ? ' Model lebih akurat daripada tebakan naif.'
              : ' Model BELUM lebih akurat daripada tebakan naif, jadi ramalan tidak dipakai untuk menyarankan menunda penjualan.'}
          </p>
        </div>
      )}

      <div className="card">
        <h3>Rekomendasi waktu jual (berbasis aturan)</h3>
        <div className={`alert ${kep === 'tunggu' ? 'success' : 'info'}`}><b>{NAMA_KEPUTUSAN[kep]}</b></div>
        <ul>{hasil.alasan.map((a, i) => <li key={i}>{a}</li>)}</ul>
        <p className="muted">Aturan ini transparan dan dihitung dari ramalan, hasil uji mundur, dan volatilitas. Ambang batas adalah parameter heuristik, bukan hasil kalibrasi pasar.</p>
      </div>

      <div className="card">
        <h3>Penjelasan oleh AI (LLM)</h3>
        <p className="muted">Opsional: isi data Simulasi Jual agar ikut dipertimbangkan.</p>
        <div className="row">
          <div className="field"><label>Total berat (kg)</label><input className="input" type="number" min="0" value={sim.berat} onChange={setS('berat')} /></div>
          <div className="field"><label>Ongkir (Rp/kg)</label><input className="input" type="number" min="0" value={sim.ongkir} onChange={setS('ongkir')} /></div>
          <div className="field"><label>Biaya lain (Rp/kg)</label><input className="input" type="number" min="0" value={sim.biayaLain} onChange={setS('biayaLain')} /></div>
          <div className="field"><label>Susut (%)</label><input className="input" type="number" min="0" max="100" step="0.1" value={sim.susutPersen} onChange={setS('susutPersen')} /></div>
        </div>
        <button className="btn" onClick={mintaPenjelasan} disabled={memuat || !online || hasil.status !== 'ok'}>
          {memuat ? 'Meminta analisis...' : 'Minta penjelasan AI'}
        </button>
        {!online && <p className="muted">Sedang offline. Ramalan di atas tetap tersedia, penjelasan AI memerlukan internet.</p>}

        {ai && (
          <div style={{ marginTop: 14 }}>
            {ai.sumber === 'llm' && ai.penjelasan ? (
              <>
                <div className={`alert ${ai.penjelasan.konsisten ? 'success' : 'info'}`}>
                  <b>Pertimbangan AI: {NAMA_KEPUTUSAN[ai.penjelasan.keputusan]}</b>
                  {!ai.penjelasan.konsisten && <div>AI berbeda dari rekomendasi aturan di atas. Pertimbangkan keduanya secara manual.</div>}
                </div>
                <p>{ai.penjelasan.ringkasan}</p>
                {ai.penjelasan.alasan.length > 0 && <><b>Alasan</b><ul>{ai.penjelasan.alasan.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
                {ai.penjelasan.risiko.length > 0 && <><b>Risiko</b><ul>{ai.penjelasan.risiko.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
                {ai.penjelasan.saran_tindakan && <p><b>Saran:</b> {ai.penjelasan.saran_tindakan}</p>}
                {ai.penjelasan.angkaTakTerverifikasi.length > 0 && (
                  <div className="alert">Peringatan: AI menyebut angka yang tidak ada pada hasil perhitungan ({ai.penjelasan.angkaTakTerverifikasi.join(', ')}). Abaikan angka tersebut.</div>
                )}
              </>
            ) : (
              <div className="alert info">{ai.catatan || 'Penjelasan AI tidak tersedia.'} Hasil berbasis aturan di atas tetap berlaku.</div>
            )}
            <p className="muted">
              AI hanya menerima angka hasil hitung di atas, bukan data pribadi petani. Penjelasan AI bukan jaminan harga dan bukan nasihat keuangan; keputusan akhir ada pada pengurus koperasi.
              Pemakaian hari ini: {ai.batas_harian.terpakai}/{ai.batas_harian.batas}.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
