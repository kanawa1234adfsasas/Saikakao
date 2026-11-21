-- =====================================================================
-- Menjadikan SATU akun sebagai admin (kepala koperasi).
-- Langkah: daftar dulu lewat halaman /daftar di aplikasi, lalu jalankan ini
-- (ganti emailnya) di Supabase -> SQL Editor. Setelah itu keluar dan masuk lagi.
-- Peran admin tidak bisa didapat lewat pendaftaran; hanya lewat SQL ini.
-- PENTING: jangan jadikan admin lebih dari satu koperasi pada proyek yang sama.
-- Saat ini semua admin dapat melihat dan mengubah SEMUA data (belum dipisah per koperasi).
-- =====================================================================
update public.profiles
set role = 'admin', is_active = true
where id = (select id from auth.users where email = 'GANTI-DENGAN-EMAIL-ADMIN@contoh.com');

-- Cek hasilnya (harus muncul 1 baris dengan role = admin):
select p.nama, p.role, p.is_active, u.email
from public.profiles p join auth.users u on u.id = p.id
where p.role = 'admin';
