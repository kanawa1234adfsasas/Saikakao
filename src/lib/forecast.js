// =====================================================================
// Analisis harga kakao: ramalan jangka pendek + rekomendasi waktu jual.
//
// Metode (machine learning klasik / statistika deret waktu, tanpa melatih model besar):
//   1. Deret harga dirata-ratakan per MINGGU; minggu kosong diisi interpolasi linear.
//   2. Ramalan: Holt's damped exponential smoothing (level + tren teredam).
//      Parameter alpha dan beta dipilih otomatis dari data (minimum galat satu langkah).
//   3. Uji mundur (rolling-origin backtest): model dibandingkan dengan tebakan naif
//      ("harga minggu depan = harga minggu ini"). Jika tidak lebih baik, ramalan TIDAK
//      dipakai untuk menyarankan menunggu.
//   4. Rekomendasi: aturan keputusan transparan dari hasil ramalan, uji mundur, dan volatilitas.
//
// Semua fungsi murni (tanpa jaringan), sehingga bisa dijalankan di peramban saat offline
// maupun di server. Ambang batas adalah parameter heuristik, bukan hasil kalibrasi.
// =====================================================================

export const PARAM = {
  MIN_MINGGU: 8,        // minimal jumlah minggu asli agar analisis dilakukan
  MIN_LATIH_BACKTEST: 6, // data minimal untuk satu putaran uji mundur
  PHI: 0.95,            // peredaman tren (0..1); makin kecil makin konservatif
  AMBANG_NAIK: 2,       // % perubahan ramalan 4 minggu untuk dianggap "naik berarti"
  AMBANG_TURUN: -2,
  AMBANG_VOLATIL: 5,    // % simpangan baku galat terhadap level untuk dianggap "bergejolak"
  Z80: 1.2816,          // pengali selang kepercayaan ~80%
  CAKRAWALA: 4,         // minggu ke depan yang diramal
};

const HARI = 86400000;
const hariKe = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / HARI;
};
const isoDari = (hari) => new Date(hari * HARI).toISOString().slice(0, 10);
const rata = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// ---------- 1. deret mingguan ----------
// entries: [{ tanggal: 'YYYY-MM-DD', harga_per_kg: number }]
export function bentukDeretMingguan(entries) {
  const valid = (entries || [])
    .map((e) => ({ hari: hariKe(e.tanggal), harga: Number(e.harga_per_kg) }))
    .filter((e) => Number.isFinite(e.hari) && Number.isFinite(e.harga) && e.harga > 0)
    .sort((a, b) => a.hari - b.hari);
  if (valid.length === 0) return { minggu: [], nAsli: 0, nInterpolasi: 0 };

  const awal = valid[0].hari;
  const grup = new Map();
  for (const e of valid) {
    const k = Math.floor((e.hari - awal) / 7);
    if (!grup.has(k)) grup.set(k, []);
    grup.get(k).push(e.harga);
  }
  const kMax = Math.max(...grup.keys());
  const minggu = [];
  let nInterpolasi = 0;
  for (let k = 0; k <= kMax; k++) {
    if (grup.has(k)) {
      minggu.push({ k, tanggal: isoDari(awal + k * 7), nilai: rata(grup.get(k)), asli: true });
    } else {
      minggu.push({ k, tanggal: isoDari(awal + k * 7), nilai: NaN, asli: false });
    }
  }
  // interpolasi linear untuk minggu kosong
  for (let i = 0; i < minggu.length; i++) {
    if (minggu[i].asli) continue;
    let a = i - 1; while (a >= 0 && !minggu[a].asli && Number.isNaN(minggu[a].nilai)) a--;
    let b = i + 1; while (b < minggu.length && !minggu[b].asli) b++;
    const nilaiA = minggu[a].nilai, nilaiB = minggu[b].nilai;
    minggu[i].nilai = nilaiA + ((nilaiB - nilaiA) * (i - a)) / (b - a);
    nInterpolasi++;
  }
  return { minggu, nAsli: grup.size, nInterpolasi };
}

// ---------- 2. Holt teredam ----------
function jalankanHolt(y, alpha, beta, phi) {
  const n = y.length;
  const m = Math.min(3, n - 1);
  let level = y[0];
  let tren = m > 0 ? (y[m] - y[0]) / m : 0;
  let sse = 0;
  const galat = [];
  for (let t = 1; t < n; t++) {
    const prediksi = level + phi * tren;
    const e = y[t] - prediksi;
    galat.push(e);
    sse += e * e;
    const levelBaru = alpha * y[t] + (1 - alpha) * (level + phi * tren);
    tren = beta * (levelBaru - level) + (1 - beta) * phi * tren;
    level = levelBaru;
  }
  return { level, tren, sse, galat };
}

export function sesuaikanHolt(y, phi = PARAM.PHI) {
  let terbaik = null;
  for (let a = 0.1; a <= 0.9001; a += 0.1) {
    for (let b = 0.05; b <= 0.5001; b += 0.05) {
      const h = jalankanHolt(y, a, b, phi);
      if (!terbaik || h.sse < terbaik.sse) terbaik = { ...h, alpha: a, beta: b };
    }
  }
  const sd = Math.sqrt(terbaik.sse / Math.max(1, terbaik.galat.length));
  return { ...terbaik, sd, phi };
}

export function ramalHolt(model, langkah = PARAM.CAKRAWALA) {
  const out = [];
  let jumlahPhi = 0;
  for (let h = 1; h <= langkah; h++) {
    jumlahPhi += Math.pow(model.phi, h);
    const nilai = model.level + jumlahPhi * model.tren;
    const lebar = PARAM.Z80 * model.sd * Math.sqrt(h);
    out.push({ h, nilai, bawah: Math.max(0, nilai - lebar), atas: nilai + lebar });
  }
  return out;
}

// ---------- 3. uji mundur ----------
export function ujiMundur(y) {
  const n = y.length;
  if (n < PARAM.MIN_LATIH_BACKTEST + 2) return { nUji: 0, mape: null, mapeNaif: null, akurasiArah: null, lebihBaikDariNaif: false };
  let sMape = 0, sNaif = 0, benarArah = 0, nArah = 0, nUji = 0;
  for (let t = PARAM.MIN_LATIH_BACKTEST; t < n; t++) {
    const latih = y.slice(0, t);
    const m = sesuaikanHolt(latih);
    const pred = ramalHolt(m, 1)[0].nilai;
    const nyata = y[t];
    sMape += Math.abs(nyata - pred) / nyata;
    sNaif += Math.abs(nyata - latih[latih.length - 1]) / nyata;
    const arahNyata = Math.sign(nyata - latih[latih.length - 1]);
    const arahPred = Math.sign(pred - latih[latih.length - 1]);
    if (arahNyata !== 0) { nArah++; if (arahNyata === arahPred) benarArah++; }
    nUji++;
  }
  const mape = (sMape / nUji) * 100;
  const mapeNaif = (sNaif / nUji) * 100;
  return {
    nUji, mape, mapeNaif,
    akurasiArah: nArah ? (benarArah / nArah) * 100 : null,
    lebihBaikDariNaif: mape < mapeNaif,
  };
}

// ---------- 4. rekomendasi berbasis aturan ----------
export function aturanKeputusan({ status, terakhir, ramalan, uji, volatilitasPersen, selisihKolektifPerKg }) {
  const alasan = [];
  if (status !== 'ok') {
    return { keputusan: 'data_kurang', alasan: [`Data harga mingguan belum cukup (minimal ${PARAM.MIN_MINGGU} minggu).`] };
  }
  const ramalanAkhir = ramalan[ramalan.length - 1];
  const perubahan = ((ramalanAkhir.nilai - terakhir) / terakhir) * 100;
  const dipercaya = uji.nUji >= 4 && uji.lebihBaikDariNaif;

  if (typeof selisihKolektifPerKg === 'number' && Number.isFinite(selisihKolektifPerKg)) {
    alasan.push(selisihKolektifPerKg > 0
      ? 'Simulasi Jual: menjual kolektif ke tujuan lebih menguntungkan dibanding harga lokal.'
      : 'Simulasi Jual: menjual kolektif ke tujuan belum lebih menguntungkan dibanding harga lokal.');
  }

  let keputusan;
  if (!dipercaya) {
    keputusan = 'jual_sekarang';
    alasan.unshift('Ramalan belum terbukti lebih akurat daripada sekadar memakai harga terakhir, jadi tidak dijadikan alasan untuk menunda penjualan.');
  } else if (perubahan >= PARAM.AMBANG_NAIK && ramalanAkhir.bawah >= terakhir * 0.98) {
    keputusan = 'tunggu';
    alasan.unshift(`Tren harga cenderung naik; ramalan ${PARAM.CAKRAWALA} minggu lebih tinggi ${perubahan.toFixed(1)}% dari harga terakhir.`);
  } else if (perubahan <= PARAM.AMBANG_TURUN && ramalanAkhir.atas <= terakhir * 1.02) {
    keputusan = 'jual_sekarang';
    alasan.unshift(`Tren harga cenderung turun; ramalan ${PARAM.CAKRAWALA} minggu lebih rendah ${Math.abs(perubahan).toFixed(1)}% dari harga terakhir.`);
  } else if (volatilitasPersen >= PARAM.AMBANG_VOLATIL) {
    keputusan = 'jual_sebagian';
    alasan.unshift('Harga bergejolak dan arah ramalan tidak tegas; menjual sebagian mengurangi risiko.');
  } else {
    keputusan = 'jual_sekarang';
    alasan.unshift('Ramalan relatif datar; tidak ada alasan kuat untuk menunda penjualan.');
  }
  return { keputusan, alasan };
}

// ---------- gabungan ----------
// entries: harga LOKAL kering [{tanggal, harga_per_kg}]
export function analisisHarga(entries, opsi = {}) {
  const { minggu, nAsli, nInterpolasi } = bentukDeretMingguan(entries);
  const status = nAsli >= PARAM.MIN_MINGGU ? 'ok' : 'data_kurang';
  const y = minggu.map((m) => m.nilai);
  const terakhir = y.length ? y[y.length - 1] : null;

  if (status !== 'ok') {
    return {
      status, nAsli, nInterpolasi, minggu, terakhir, ramalan: [], uji: null, model: null,
      volatilitasPersen: null, ...aturanKeputusan({ status }),
    };
  }
  const model = sesuaikanHolt(y);
  const ramalan = ramalHolt(model).map((r) => ({
    ...r, tanggal: isoDari(hariKe(minggu[minggu.length - 1].tanggal) + 7 * r.h),
  }));
  const uji = ujiMundur(y);
  const volatilitasPersen = (model.sd / model.level) * 100;
  const kep = aturanKeputusan({
    status, terakhir, ramalan, uji, volatilitasPersen, selisihKolektifPerKg: opsi.selisihKolektifPerKg,
  });
  return {
    status, nAsli, nInterpolasi, minggu, terakhir, ramalan, uji, volatilitasPersen,
    model: { alpha: model.alpha, beta: model.beta, phi: model.phi, level: model.level, tren: model.tren, sd: model.sd },
    ...kep,
  };
}

// ---------- ringkasan fakta untuk LLM (hanya angka hasil hitung) ----------
export function ringkasFaktaUntukLlm(hasil, tambahan = {}) {
  const r = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(d)) : null);
  return {
    komoditas: 'kakao kering',
    satuan: 'Rp per kg',
    minggu_data_asli: hasil.nAsli,
    harga_terakhir: r(hasil.terakhir),
    ramalan: hasil.ramalan.map((x) => ({ minggu_ke: x.h, nilai: r(x.nilai), bawah: r(x.bawah), atas: r(x.atas) })),
    volatilitas_persen: r(hasil.volatilitasPersen, 1),
    uji_mundur: hasil.uji && {
      jumlah_uji: hasil.uji.nUji,
      galat_model_persen: r(hasil.uji.mape, 1),
      galat_tebakan_naif_persen: r(hasil.uji.mapeNaif, 1),
      lebih_baik_dari_naif: hasil.uji.lebihBaikDariNaif,
      akurasi_arah_persen: r(hasil.uji.akurasiArah, 0),
    },
    keputusan_aturan: hasil.keputusan,
    alasan_aturan: hasil.alasan,
    ...tambahan,
  };
}

// ---------- pemeriksaan angka pada jawaban LLM ----------
// Mengembalikan daftar angka pada teks yang TIDAK ada di fakta (indikasi karangan/halusinasi).
export function angkaTidakTerverifikasi(teks, fakta) {
  const dariFakta = new Set(
    (JSON.stringify(fakta).match(/\d+(?:[.,]\d+)*/g) || []).map((x) => x.replace(/\D/g, '')),
  );
  const dariTeks = (String(teks).match(/\d+(?:[.,]\d+)*/g) || []);
  const tidak = [];
  for (const t of dariTeks) {
    const norm = t.replace(/\D/g, '');
    if (!dariFakta.has(norm)) tidak.push(t);
  }
  return [...new Set(tidak)];
}
