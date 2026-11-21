# JualTepat

Platform koperasi kakao digital (PWA) untuk kelompok tani di Lampung: pencatatan anggota, lahan, panen, harga,
**Analisis Harga berbasis AI** (ramalan + rekomendasi waktu jual), dan Simulasi Jual.

**Mulai dari sini: baca `PANDUAN_SETUP.md`** (dari unggah ke GitHub sampai aplikasi online).

## Dua peran
- **Admin (kepala koperasi):** anggota, lahan petani, harga, panen, pembeli dan tarif kirim, Simulasi Jual, Analisis AI, pengumuman.
- **Petani:** harga dan grafik, panen dan lahan sendiri (lihat saja), informasi, pengumuman, ubah kata sandi.

## Teknologi
Next.js 14 (App Router, JavaScript), React 18, Supabase (PostgreSQL, Auth, Row Level Security, Storage), Vercel.
Fitur AI: ramalan Holt teredam dengan uji mundur (dihitung di perangkat, jalan saat offline) + penjelasan LLM opsional lewat endpoint server.

## Struktur folder
```
src/app/            halaman (landing, masuk, daftar, admin/*, petani/*, api/analisis-harga)
src/components/     komponen (landing, admin, petani, RoleGuard, OfflineBanner, dll.)
src/lib/            supabase.js, forecast.js (ramalan), simulasi.js, offlineCache.js, dll.
public/             manifest, service worker, ikon, halaman offline (+ images/ untuk foto)
supabase/           01_schema_lengkap.sql, 02_ai_logs.sql, 03_jadikan_admin.sql, 04_data_contoh_opsional.sql
scripts/rename.mjs  ganti nama aplikasi
```

## Menjalankan di komputer sendiri
```
npm install
copy .env.local.example .env.local     (Windows)   |   cp .env.local.example .env.local   (Mac/Linux)
npm run dev
```
Isi `.env.local` dengan URL dan anon key Supabase. Jangan pernah meng-commit `.env.local`.
Tombol Install dan service worker hanya aktif pada versi production (`npm run build && npm start`, atau di Vercel).

## Keamanan
- Hak akses dijaga di database (Row Level Security). Petani hanya membaca data miliknya dan tidak bisa membaca data pembeli atau tarif.
- Peran admin tidak bisa didapat lewat pendaftaran; hanya lewat SQL (`supabase/03_jadikan_admin.sql`).
- Kunci LLM hanya dipakai di server (`ANTHROPIC_API_KEY`), tidak pernah dikirim ke peramban.
- **Batasan saat ini:** satu proyek melayani satu koperasi. Semua admin dapat melihat semua data, jadi jangan memberi akun admin ke koperasi yang berbeda.

## Status fitur
Ada: landing page + install PWA, daftar/masuk, dua peran, anggota (tambah, ubah, aktif/nonaktif), lahan + foto, harga + grafik,
panen, pembeli dan tarif, Simulasi Jual, Analisis Harga AI, pengumuman, profil, cache offline.
Belum ada (rencana): penjualan kolektif dan bagi hasil otomatis, dukungan banyak koperasi dengan admin tiap lokasi,
notifikasi WhatsApp, harga dan ongkir otomatis, ketertelusuran batch.

## Pustaka perangkat lunak (untuk dokumentasi)
| Komponen | Lisensi |
|---|---|
| Next.js, React, React DOM, @supabase/supabase-js | MIT (terverifikasi dari `package-lock.json`) |
| Supabase, Vercel, GitHub (layanan) | Ketentuan layanan masing-masing |
| Anthropic API (opsional, layanan LLM) | Ketentuan layanan Anthropic |
Grafik dan ramalan dibuat sendiri (SVG dan JavaScript murni), tanpa pustaka tambahan.
