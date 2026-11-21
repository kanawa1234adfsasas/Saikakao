// Cache data terakhir di peramban agar halaman tetap menampilkan data saat sinyal hilang.
// Disimpan di localStorage perangkat; dihapus saat pengguna keluar (lihat hapusCacheSemua).
const PREFIX = 'app:cache:';

export function simpanCache(kunci, data) {
  try { localStorage.setItem(PREFIX + kunci, JSON.stringify({ t: Date.now(), data })); } catch { /* penuh/diblokir */ }
}

export function bacaCache(kunci) {
  try {
    const s = localStorage.getItem(PREFIX + kunci);
    return s ? JSON.parse(s) : null; // { t, data }
  } catch { return null; }
}

export function hapusCacheSemua() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* abaikan */ }
}
