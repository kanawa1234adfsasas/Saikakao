'use client';
import { useEffect, useState } from 'react';

// Pita peringatan saat perangkat tidak terhubung internet.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const perbarui = () => setOffline(!navigator.onLine);
    perbarui();
    window.addEventListener('online', perbarui);
    window.addEventListener('offline', perbarui);
    return () => { window.removeEventListener('online', perbarui); window.removeEventListener('offline', perbarui); };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, background: '#7A4A00',
      color: '#fff', textAlign: 'center', padding: '6px 12px', fontSize: '.85rem' }}>
      Tidak ada koneksi internet. Menampilkan data terakhir yang tersimpan; perubahan baru belum bisa disimpan.
    </div>
  );
}
