// Pajak invoice, Faktur Pajak, default lembur & perjalanan dinas (prefix tx_). 2026-11-09.
export const taxId = {
  // Profile editor
  tx_ppn: 'PPN', tx_ppnOn: 'Kenakan PPN (agency PKP)', tx_ppnRate: 'Tarif PPN (%)',
  tx_ppnBase: 'Dasar pengenaan', tx_base_nilai_lain: 'DPP nilai lain 11/12 (efektif 11 %)', tx_base_full: 'DPP penuh',
  tx_tip_ppn: 'Sejak 2025 tarif PPN 12 % dikenakan atas DPP nilai lain = 11/12 × harga jual, sehingga efektif 11 %. Pilih "DPP penuh" hanya bila klien/aturan meminta lain.',
  tx_pph: 'PPh / pajak lain', tx_pphMode: 'Perlakuan',
  tx_mode_none: 'Tidak ada', tx_mode_withheld: 'Dipotong klien (PPh 23, bukti potong)', tx_mode_added: 'Ditambahkan ke tagihan',
  tx_tip_pph: 'Dipotong klien: klien membayar tagihan dikurangi PPh dan memberi bukti potong — invoice & faktur tidak berubah, tercatat sebagai PPh 23 dibayar di muka. Ditambahkan: baris pajak (mis. "Pajak 2,5 %") ikut menambah total tagihan, sesuai permintaan klien tertentu.',
  tx_pphRate: 'Tarif (%)', tx_pphLabel: 'Label cetak', tx_example: 'Contoh untuk Rp10.000.000',
  // Breakdown rows
  tx_subtotal: 'Sub Total', tx_discount: 'Diskon', tx_dpp: 'DPP (harga jual)', tx_dppOther: 'DPP nilai lain', tx_ppnRow: 'PPN {rate}%',
  tx_total: 'TOTAL', tx_withheld: '{label} {rate}% dipotong klien', tx_net: 'Jumlah diterima',
  // Settings section
  tx_sectionTitle: 'Pajak invoice', tx_sectionSub: 'Default agency, lalu pengecualian per perusahaan klien. Invoice = faktur pajak.',
  tx_default: 'Default agency', tx_perClient: 'Per perusahaan klien', tx_useDefault: 'Ikuti default', tx_custom: 'Atur khusus',
  tx_saved: 'Pengaturan pajak tersimpan.', tx_search: 'Cari perusahaan…',
  // Dokumen invoice
  tx_invTax: 'Pajak invoice ini', tx_invTaxFrom: 'Dari Pengaturan: {src}', tx_srcClient: 'khusus klien', tx_srcDefault: 'default agency',
  tx_overrideHere: 'Ubah khusus invoice ini', tx_rates: 'Tarif lembur {ot}/jam · inap {lod}/malam', tx_ratesLegacy: 'Tarif lama (belum diatur di Pengaturan → Lembur & Perjalanan Dinas)',
  tx_discountRp: 'Diskon (Rp)',
  // Ops default settings
  tx_opsTitle: 'Lembur & perjalanan dinas (default)', tx_opsSub: 'Dipakai kontrak yang tidak mengatur sendiri, dan order harian (tarif lembur per jam & inap per malam di invoice).',
  tx_opsSaved: 'Default lembur & perjalanan dinas tersimpan.', tx_opsDaily: 'Order harian memakai: lembur {ot}/jam · inap {lod}/malam',
  tx_opsNotSet: 'Belum diatur — invoice harian masih memakai tarif lama Rp50.000/jam dan Rp150.000/malam.',
  payPph23: 'PPh 23 dipotong klien (bukti potong)', payPph23Ref: 'No. bukti potong',
  // Rekap Order mapping columns
  rk_letterNo: 'No. Surat Pengantar', rk_faktur: 'No. Faktur Pajak', rk_contract: 'Kontrak', rk_fakturDraft: 'draft',
  // Faktur Pajak tab
  fk_tab: 'Faktur Pajak', fk_title: 'Faktur Pajak', fk_help: 'Satu faktur boleh berisi beberapa invoice dari pembeli yang sama dalam masa pajak (bulan Tgl Kirim) yang sama. PPN dihitung sekali atas jumlah DPP, lalu dibagi kembali ke tiap invoice sehingga total invoice = faktur.',
  fk_masa: 'Masa pajak', fk_candidates: 'Invoice siap difakturkan', fk_noCandidates: 'Tidak ada invoice terkirim ber-PPN yang belum masuk faktur pada masa ini.',
  fk_make: 'Buat faktur dari {n} invoice', fk_list: 'Daftar faktur', fk_empty: 'Belum ada faktur.',
  fk_buyer: 'Pembeli', fk_npwp: 'NPWP', fk_nsfp: 'NSFP', fk_date: 'Tgl faktur', fk_kind: 'Jenis', fk_status: 'Status',
  fk_kind_tunggal: 'Tunggal', fk_kind_gabungan: 'Gabungan',
  fk_status_draft: 'Draft', fk_status_terbit: 'Terbit', fk_status_diganti: 'Diganti', fk_status_batal: 'Batal',
  fk_issue: 'Terbitkan', fk_issueNeed: 'Isi NSFP dan tanggal faktur dari Coretax lalu klik Terbitkan.', fk_replace: 'Buat pengganti', fk_cancel: 'Batalkan',
  fk_confirmCancel: 'Batalkan faktur ini? Invoice di dalamnya dilepas dan kembali ke PPN masing-masing.', fk_confirmReplace: 'Buat faktur pengganti? Faktur ini menjadi "Diganti" dan isinya pindah ke draft baru.',
  fk_upload: 'Unggah PDF', fk_open: 'Buka PDF', fk_remove: 'Lepas', fk_export: 'Ekspor CSV', fk_save: 'Simpan', fk_mixedBuyer: 'Pilih invoice dari satu pembeli saja.',
  fk_lockedNote: 'Faktur terbit mengunci invoice di dalamnya. Untuk mengubah, buat pengganti.',
  fk_created: 'Faktur dibuat.', fk_updated: 'Faktur diperbarui.',
};
