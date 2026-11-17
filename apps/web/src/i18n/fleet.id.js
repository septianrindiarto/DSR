// Armada → Kelola tipe kendaraan (prefix ft_). 2026-11-11.
export const fleetId = {
  ft_manage: 'Kelola tipe', ft_title: 'Tipe kendaraan', ft_sub: 'Daftar tipe milik agency Anda — dipakai di form Armada dan kategori Tarif.',
  ft_add: 'Tambah', ft_addPh: 'Tipe baru, mis. Hiace Commuter', ft_units: '{n} unit', ft_renamed: 'ganti nama',
  ft_inUse: 'Masih dipakai unit — ganti nama atau pindahkan unitnya dulu', ft_saved: 'Tipe kendaraan tersimpan.',
  ft_dup: 'Tipe "{name}" sudah ada.', ft_dupAny: 'Ada nama tipe yang sama.',
  ft_orphan: 'Masih dipakai unit tapi tidak ada di daftar: {list}. Kembalikan atau ganti nama.',
  ft_pricingNote: 'Mengganti nama memindahkan semua unit bertipe itu. Tipe baru otomatis muncul sebagai kategori di Tarif; unit tanpa tarif memakai harga unit.',
  // Armada → Perawatan & darurat per unit (owner 2026-11-13, prefix ue_)
  ue_btn: 'Perawatan & darurat', ue_title: 'Perawatan & darurat', ue_onContract: 'Unit kontrak {c}',
  ue_schedule: 'Jadwal perawatan', ue_scheduleHelp: 'Jadwal di sini dipakai otomatis oleh Jadwal, kontrak (unit pengganti), dashboard dan pengingat harian. Unit dianggap tidak tersedia dari tanggal mulai sampai selesai.',
  ue_from: 'Mulai', ue_to: 'Selesai', ue_type: 'Jenis', ue_desc: 'Keterangan', ue_add: 'Jadwalkan', ue_when: 'Tanggal',
  ue_type_routine: 'Servis berkala', ue_type_repair: 'Perbaikan', ue_type_inspection: 'Pemeriksaan',
  ue_m_scheduled: 'Terjadwal', ue_m_in_progress: 'Berjalan', ue_m_completed: 'Selesai',
  ue_start: 'Mulai', ue_done: 'Selesai', ue_mRemove: 'Hapus jadwal ini?', ue_noSchedule: 'Belum ada jadwal perawatan.',
  ue_mAdded: 'Jadwal perawatan tersimpan.', ue_mAddedContract: 'Jadwal tersimpan. Unit ini dipakai kontrak {c} — siapkan unit pengganti (klien sudah diberi tahu).',
  ue_incidents: 'Laporan darurat / kendala', ue_report: 'Lapor darurat', ue_noIncidents: 'Belum ada laporan.',
  ue_unit: 'Unit', ue_incKind: 'Jenis kejadian', ue_incWhat: 'Apa yang terjadi', ue_incWhere: 'Lokasi', ue_incOffRoad: 'Unit tidak bisa jalan (perlu pengganti)',
  ue_incSend: 'Kirim laporan', ue_incFill: 'Pilih unit dan ceritakan kejadiannya.', ue_incSent: 'Laporan terkirim{c}. Agency dan klien diberi tahu.',
  ue_incHelp: 'Laporan langsung dikirim ke admin agency dan klien kontrak unit ini (notifikasi, e-mail, Telegram).',
  ue_kind_breakdown: 'Mogok / rusak', ue_kind_accident: 'Kecelakaan', ue_kind_tire: 'Ban', ue_kind_other: 'Lainnya',
  ue_offRoad: 'Tidak bisa jalan', ue_resolve: 'Tandai selesai', ue_resolved: 'Selesai', ue_incResolvePrompt: 'Penanganan / catatan penyelesaian:',
  ue_replacements: 'Unit pengganti', ue_repBy: 'diganti unit lain', ue_repFor: 'menjadi pengganti', ue_ended: 'selesai',
  ue_reason_maintenance: 'perawatan', ue_reason_emergency: 'darurat', ue_reason_other: 'lainnya',
  // Contract → unit pengganti (prefix rp_)
  rp_title: 'Unit pengganti', rp_help: 'Bila unit kontrak sedang perawatan atau darurat, tetapkan mobil pengganti untuk rentang tanggalnya. Form lembur / perjalanan dinas / operasional di rentang itu otomatis tercatat di mobil pengganti. Klien diberi tahu.',
  rp_needed: 'Perlu pengganti', rp_unit: 'Unit kontrak', rp_car: 'Mobil pengganti', rp_from: 'Mulai', rp_to: 'Selesai (kosong = sampai diakhiri)',
  rp_reason: 'Alasan', rp_note: 'Catatan', rp_add: 'Tetapkan pengganti', rp_added: 'Unit pengganti ditetapkan.', rp_end: 'Akhiri', rp_endPrompt: 'Tanggal selesai (YYYY-MM-DD), kosong = hari ini:',
  rp_none: 'Belum ada unit pengganti.', rp_active: 'aktif', rp_ended: 'selesai', rp_use: 'Pakai',
  // Dashboard / bell (prefix nt_)
  nt_title: 'Notifikasi', nt_none: 'Tidak ada notifikasi.', nt_readAll: 'Tandai semua dibaca', nt_actions: 'Perlu tindakan', nt_noActions: 'Tidak ada yang perlu ditindaklanjuti.',
  nt_open: 'Buka', nt_driverReport: 'Lapor darurat / kendala',
};
