// Mengganti nama aplikasi di seluruh proyek.
// Pemakaian:  node scripts/rename.mjs "NamaBaru" --dari "NamaSekarang" [--coba]
//   contoh:   node scripts/rename.mjs "TaniPintar" --dari "JualTepat"
//   --coba    hanya menampilkan berkas yang akan berubah, tanpa menulis
// Nama dengan dua huruf kapital (mis. "JualTepat") dibuat dua warna: Jual<span>Tepat</span>.
// Nama dengan dua huruf kapital (mis. "JualTepat") dibuat dua warna: Jual<span>Tepat</span>.
import fs from 'node:fs';
import path from 'node:path';

const iDari = process.argv.indexOf('--dari');
const LAMA = iDari > -1 ? process.argv[iDari + 1] : 'JualTepat';
const baru = process.argv[2];
const coba = process.argv.includes('--coba');
if (!baru || baru.startsWith('--')) { console.error('Pemakaian: node scripts/rename.mjs "NamaBaru"'); process.exit(1); }
if (!/^[A-Za-z0-9 ]{2,30}$/.test(baru)) { console.error('Nama hanya boleh huruf, angka, dan spasi (2-30 karakter).'); process.exit(1); }

const kecil = baru.replace(/\s+/g, '').toLowerCase();
const kecilLama = LAMA.replace(/\s+/g, '').toLowerCase();
const mLama = LAMA.match(/^(.+?)([A-Z][a-z0-9]+)$/);
const dwiWarnaLama = mLama && !/\s/.test(LAMA) ? `${mLama[1]}<span>${mLama[2]}</span>` : null;
const m = baru.match(/^(.+?)([A-Z][a-z0-9]+)$/); // pisah di huruf kapital terakhir
const [bagA, bagB] = m && !/\s/.test(baru) ? [m[1], m[2]] : [baru, ''];
const dwiWarna = bagB ? `${bagA}<span>${bagB}</span>` : baru;

const ROOT = process.cwd();
const ABAIKAN = new Set(['node_modules', '.next', '.git', 'package-lock.json']);
const EKSTENSI = new Set(['.js', '.css', '.json', '.md', '.sql', '.html', '.webmanifest', '.mjs']);
let berkas = 0, ganti = 0;

function telusuri(dir) {
  for (const nama of fs.readdirSync(dir)) {
    if (ABAIKAN.has(nama)) continue;
    const p = path.join(dir, nama);
    const st = fs.statSync(p);
    if (st.isDirectory()) { telusuri(p); continue; }
    if (!EKSTENSI.has(path.extname(nama)) || nama === 'rename.mjs') continue;
    const asal = fs.readFileSync(p, 'utf8');
    let teks = asal;
    if (dwiWarnaLama) teks = teks.split(dwiWarnaLama).join(dwiWarna);
    teks = teks.split(LAMA).join(baru);
    teks = teks.split(kecilLama).join(kecil);
    if (teks !== asal) {
      berkas++; ganti += asal.split(LAMA).length - 1;
      console.log(coba ? '[coba]' : '[ubah]', path.relative(ROOT, p));
      if (!coba) fs.writeFileSync(p, teks);
    }
  }
}
telusuri(ROOT);
console.log(`\nSelesai: ${berkas} berkas${coba ? ' (mode coba, belum ditulis)' : ' diubah'}. Nama baru: ${baru}`);
console.log('Periksa juga secara manual: logo/gambar yang memuat teks nama, serta kontak di src/app/page.js.');
