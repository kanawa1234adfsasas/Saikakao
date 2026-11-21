-- =====================================================================
-- DATA CONTOH (SIMULASI) - OPSIONAL, hanya untuk mencoba aplikasi dan fitur Analisis AI.
-- Semua angka DIKARANG dan diberi tanda is_simulasi = true. Jangan dipakai sebagai data nyata.
-- Jika kamu punya riwayat harga nyata (lengkap dengan sumber), pakai itu dan lewati berkas ini.
-- Fitur Analisis AI butuh minimal 8 minggu harga lokal kakao kering.
-- Jalankan SEKALI (menjalankan ulang akan menggandakan data).
-- =====================================================================
insert into public.price_entries (tanggal, lokasi, jenis, kondisi, harga_per_kg, sumber, is_simulasi)
select (current_date - (30 - g) * 7), 'Pengepul lokal (simulasi)', 'lokal', 'kering',
       round(68000 + g * 350 + 1200 * sin(g * 1.3)), 'Data simulasi untuk uji aplikasi', true
from generate_series(1, 30) as g;

insert into public.price_entries (tanggal, lokasi, jenis, kondisi, harga_per_kg, sumber, is_simulasi)
select (current_date - (30 - g) * 7), 'Tujuan A (simulasi)', 'tujuan', 'kering',
       round(75000 + g * 350 + 1000 * sin(g * 1.1)), 'Data simulasi untuk uji aplikasi', true
from generate_series(1, 30) as g;

insert into public.buyers (nama, kota_tujuan, harga_penawaran, sumber, is_simulasi) values
  ('Pembeli A (contoh)', 'Kota Tujuan A', 80000, 'Data simulasi', true),
  ('Pembeli B (contoh)', 'Kota Tujuan B', 78000, 'Data simulasi', true);

insert into public.shipping_rates (asal, tujuan, tarif_per_kg, sumber, is_simulasi) values
  ('Lampung', 'Kota Tujuan A', 1500, 'Data simulasi', true),
  ('Lampung', 'Kota Tujuan B', 1200, 'Data simulasi', true);

insert into public.announcements (judul, isi) values
  ('Selamat datang', 'Ini pengumuman contoh. Data harga pada versi prototipe adalah data simulasi.');
