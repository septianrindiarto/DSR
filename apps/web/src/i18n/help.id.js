// ─── In-app help (ⓘ) — one short guide per page / tab (owner 2026-11-06) ────
// Shown by the ⓘ button in the page corner (AdminLayout → PageHelp). Keys are
// the path after /admin/ and, for tabbed pages, "<path>.<tab>". Keep each to a
// few lines: what the page is for, and the 2–4 things people do there.
export const PAGE_HELP = {
  dashboard: ["Ringkasan harian dan form pemesanan cepat.", "Klien: pesan kendaraan di sini (persetujuan & pusat biaya mengikuti aturan perusahaan)."],
  orders: [
    "Semua booking milik organisasi Anda. Satu kode transaksi bisa berisi beberapa kendaraan.",
    "✎ (edit_note) = edit beberapa kolom sekaligus di tabel; ✏️ = form lengkap.",
    "Kode: P/C harian · M kontrak bulanan · L lembur · R operasional.",
  ],
  "claim-orders": ["Order yang belum dimiliki agency mana pun.", "Kontak pelanggan tampil setelah order diklaim."],
  schedule: ["Jadwal pemakaian tiap mobil.", "Klik blok untuk melihat order; bentrok jadwal ditandai."],
  fleet: ["Daftar mobil milik agency Anda: status, foto, tarif dasar.", "Foto mobil tampil di halaman publik."],
  "fleet-care": ["Servis berkala (km / tanggal) dan masa berlaku STNK, KIR, asuransi.", "Merah = lewat, kuning = segera."],
  customers: ["Pelanggan dari booking milik agency Anda.", "Data pribadi bisa dianonimkan (hak pelanggan)."],
  drivers: ["Data driver, dokumen (terenkripsi) dan akses aplikasi driver (📱).", "Driver tidak bisa daftar sendiri — agency yang membuatkan akses."],
  analytics: ["Tren order, unit dan pendapatan.", "Trip = booking, Unit = kendaraan."],
  finance: ["Pembukuan: jurnal, laporan Laba Rugi / Neraca / Arus Kas.", "Jurnal dari invoice & pembayaran dibuat otomatis — koreksi lewat sumbernya."],
  documents: [
    "Semua invoice dan dokumen dibuat di sini.",
    "Kode transaksi: C harian, M bulanan kontrak (per unit), L lembur, T perjalanan dinas, O operasional — dibuat lewat Single / Bulk Invoice.",
    "Tandai Selesai = invoice tercatat (Tgl Kirim → jatuh tempo & jurnal).",
  ],
  pricing: ["Tarif: rate card per kategori × paket × zona kota, tarif per model, tarif korporat per klien.", "Simulasi untuk mengecek harga sebelum dipakai."],
  contracts: ["Kontrak jangka panjang, lembur & operasional, dan portal perusahaan dalam satu menu."],
  "contracts.summary": ["Ringkasan periode: kode M bulan ini, lembur, operasional per kontrak."],
  "contracts.contracts": [
    "Alur: buat kontrak (agency atau klien) → isi ketentuan & dokumen persyaratan → kedua pihak menyetujui → Aktif.",
    "Kolom kosong boleh disimpan; persetujuan terkunci sampai yang wajib terisi.",
    "Setiap perubahan ketentuan mereset persetujuan.",
  ],
  "contracts.ops": [
    "Form lembur (kode L) dan operasional / perjalanan dinas (kode R).",
    "Setiap form disetujui agency DAN klien; yang disetujui keduanya ditagih di Dokumen → Invoice (kode L / T / O).",
    "Perhitungan mengikuti matriks lembur & perjalanan dinas di kontrak.",
  ],
  "contracts.portal": ["Portal perusahaan klien: persetujuan pesanan, pengeluaran, pusat biaya, tagihan, laporan bulanan."],
  users: ["Kelola pengguna, role dan organisasi."],
  "users.users": ["Daftarkan pengguna lalu pilih role-nya. Hak akses diatur di tab Role."],
  "users.roles": ["Role = kumpulan hak akses. Role bawaan dipakai semua organisasi; ubah hak membuat salinan khusus organisasi."],
  "users.orgs": ["Organisasi agency & klien serta relasi klien ↔ agency."],
  "access-requests": ["Permintaan akses fitur dari pengguna organisasi Anda. Disetujui = hak lihat saja."],
  settings: ["Profil perusahaan, dokumen legal, penomoran dokumen, mitra (agency / klien), keamanan (2FA)."],
};
