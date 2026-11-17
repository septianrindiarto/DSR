// ─── Default chart of accounts — car rental, SAK EMKM, no tax accounts ──────
// Code scheme:  1 Aset · 2 Kewajiban · 3 Ekuitas · 4 Pendapatan Usaha ·
//               5 Beban Langsung (operasional armada) · 6 Beban Umum & Adm ·
//               7 Pendapatan / Beban Lain-lain
// Sub-blocks:   1-1xxx aset lancar, 1-2xxx aset tetap; 2-1xxx jangka pendek,
//               2-2xxx jangka panjang.
// normalBalance drives the sign of every balance, so contra accounts
// (Akumulasi Penyusutan, Prive, Diskon) work without special cases.
// isCash marks Kas/Bank (the only accounts the Arus Kas report reads).
// cashFlowClass overrides the default classification for Arus Kas.
export const DEFAULT_COA = [
    // Aset lancar
    { code: '1-1100', name: 'Kas', type: 'asset', normalBalance: 'debit', isCash: true },
    { code: '1-1200', name: 'Bank BCA', type: 'asset', normalBalance: 'debit', isCash: true },
    { code: '1-1210', name: 'Bank Lainnya', type: 'asset', normalBalance: 'debit', isCash: true },
    { code: '1-1300', name: 'Piutang Usaha', type: 'asset', normalBalance: 'debit', cashFlowClass: 'operating' },
    { code: '1-1400', name: 'Uang Muka & Biaya Dibayar di Muka', type: 'asset', normalBalance: 'debit', cashFlowClass: 'operating' },
    { code: '1-1500', name: 'Piutang Lain-lain', type: 'asset', normalBalance: 'debit', cashFlowClass: 'operating' },
    { code: '1-1600', name: 'PPh 23 Dibayar di Muka', type: 'asset', normalBalance: 'debit', cashFlowClass: 'operating' },
    // Aset tetap
    { code: '1-2100', name: 'Kendaraan', type: 'asset', normalBalance: 'debit', cashFlowClass: 'investing' },
    { code: '1-2110', name: 'Akumulasi Penyusutan Kendaraan', type: 'asset', normalBalance: 'credit', cashFlowClass: 'investing' },
    { code: '1-2200', name: 'Peralatan Kantor', type: 'asset', normalBalance: 'debit', cashFlowClass: 'investing' },
    { code: '1-2210', name: 'Akumulasi Penyusutan Peralatan', type: 'asset', normalBalance: 'credit', cashFlowClass: 'investing' },
    // Kewajiban
    { code: '2-1100', name: 'Utang Usaha (Vendor Unit)', type: 'liability', normalBalance: 'credit', cashFlowClass: 'operating' },
    { code: '2-1200', name: 'Utang Gaji & Driver', type: 'liability', normalBalance: 'credit', cashFlowClass: 'operating' },
    { code: '2-1300', name: 'Uang Muka Pelanggan', type: 'liability', normalBalance: 'credit', cashFlowClass: 'operating' },
    { code: '2-1400', name: 'Utang Lain-lain', type: 'liability', normalBalance: 'credit', cashFlowClass: 'operating' },
    { code: '2-1500', name: 'PPN Keluaran', type: 'liability', normalBalance: 'credit', cashFlowClass: 'operating' },
    { code: '2-1510', name: 'Pajak Ditagihkan ke Klien', type: 'liability', normalBalance: 'credit', cashFlowClass: 'operating' },
    { code: '2-2100', name: 'Utang Bank / Pembiayaan Kendaraan', type: 'liability', normalBalance: 'credit', cashFlowClass: 'financing' },
    // Ekuitas
    { code: '3-1000', name: 'Modal Pemilik', type: 'equity', normalBalance: 'credit', cashFlowClass: 'financing' },
    { code: '3-2000', name: 'Prive', type: 'equity', normalBalance: 'debit', cashFlowClass: 'financing' },
    { code: '3-3000', name: 'Laba Ditahan', type: 'equity', normalBalance: 'credit', cashFlowClass: 'financing' },
    { code: '3-9000', name: 'Ekuitas Saldo Awal', type: 'equity', normalBalance: 'credit', cashFlowClass: 'financing',
      description: 'Lawan saldo awal saat pindah dari pembukuan manual.' },
    // Pendapatan usaha
    { code: '4-1000', name: 'Pendapatan Sewa Kendaraan', type: 'income', normalBalance: 'credit' },
    { code: '4-1100', name: 'Pendapatan Jasa Driver', type: 'income', normalBalance: 'credit' },
    { code: '4-1200', name: 'Pendapatan Lembur & Inap', type: 'income', normalBalance: 'credit' },
    { code: '4-1900', name: 'Diskon Penjualan', type: 'income', normalBalance: 'debit' },
    // Beban langsung (armada)
    { code: '5-1000', name: 'Beban Sewa Unit Vendor', type: 'expense', normalBalance: 'debit' },
    { code: '5-1100', name: 'Beban Driver', type: 'expense', normalBalance: 'debit' },
    { code: '5-1200', name: 'Beban BBM', type: 'expense', normalBalance: 'debit' },
    { code: '5-1300', name: 'Beban Tol & Parkir', type: 'expense', normalBalance: 'debit' },
    { code: '5-1400', name: 'Beban Servis & Perawatan Kendaraan', type: 'expense', normalBalance: 'debit' },
    { code: '5-1500', name: 'Beban Pajak Kendaraan (STNK/KIR)', type: 'expense', normalBalance: 'debit' },
    { code: '5-1600', name: 'Beban Asuransi Kendaraan', type: 'expense', normalBalance: 'debit' },
    { code: '5-1700', name: 'Beban Penyusutan Kendaraan', type: 'expense', normalBalance: 'debit' },
    // Beban umum & administrasi
    { code: '6-1000', name: 'Beban Gaji Karyawan', type: 'expense', normalBalance: 'debit' },
    { code: '6-1100', name: 'Beban Sewa Kantor', type: 'expense', normalBalance: 'debit' },
    { code: '6-1200', name: 'Beban Listrik, Air & Internet', type: 'expense', normalBalance: 'debit' },
    { code: '6-1300', name: 'Beban Pemasaran & Iklan', type: 'expense', normalBalance: 'debit' },
    { code: '6-1400', name: 'Beban ATK & Perlengkapan', type: 'expense', normalBalance: 'debit' },
    { code: '6-1500', name: 'Beban Administrasi Bank', type: 'expense', normalBalance: 'debit' },
    { code: '6-1600', name: 'Beban Penyusutan Peralatan', type: 'expense', normalBalance: 'debit' },
    { code: '6-1900', name: 'Beban Umum Lain-lain', type: 'expense', normalBalance: 'debit' },
    // Lain-lain
    { code: '7-1000', name: 'Pendapatan Lain-lain', type: 'income', normalBalance: 'credit' },
    { code: '7-1100', name: 'Pendapatan Bunga Bank', type: 'income', normalBalance: 'credit' },
    { code: '7-2000', name: 'Beban Lain-lain', type: 'expense', normalBalance: 'debit' },
];

// Keyword → account code suggestions for the cash-book import wizard.
// Matched case-insensitively against the row's category/description; first
// hit wins. Users confirm or change every suggestion before importing.
export const IMPORT_KEYWORDS = {
    in: [
        [/modal|setor(an)? modal|investasi pemilik/i, '3-1000'],
        [/bunga( bank)?|jasa giro/i, '7-1100'],
        [/pelunasan|pembayaran invoice|bayar invoice|transfer (dari )?(pt|cv)/i, '1-1300'],
        [/driver|supir|sopir/i, '4-1100'],
        [/lembur|inap|overtime/i, '4-1200'],
        [/sewa|rental|rent|carter|charter|dp |uang muka/i, '4-1000'],
        [/pinjam|kredit|leasing/i, '2-2100'],
    ],
    out: [
        [/prive|pribadi|ambil (uang )?pemilik/i, '3-2000'],
        [/bbm|solar|pertalite|pertamax|bensin|dexlite|spbu/i, '5-1200'],
        [/tol|parkir|e-?toll/i, '5-1300'],
        [/servis|service|bengkel|oli|ban|sparepart|spare part|cuci/i, '5-1400'],
        [/stnk|kir|pajak kendaraan|samsat/i, '5-1500'],
        [/asuransi/i, '5-1600'],
        [/sewa unit|vendor|rental mobil|pinjam unit/i, '5-1000'],
        [/driver|supir|sopir|uang jalan|uang makan driver/i, '5-1100'],
        [/gaji|upah|honor|thr|bonus/i, '6-1000'],
        [/sewa kantor|kontrakan/i, '6-1100'],
        [/listrik|pln|air|pdam|internet|wifi|pulsa|kuota/i, '6-1200'],
        [/iklan|promosi|ads|marketing/i, '6-1300'],
        [/atk|alat tulis|print|fotokopi|perlengkapan/i, '6-1400'],
        [/admin bank|biaya admin|transfer fee|biaya transfer/i, '6-1500'],
        [/cicilan|angsuran|leasing/i, '2-2100'],
        [/beli (mobil|kendaraan|unit)/i, '1-2100'],
    ],
};

export function suggestAccountCode(label, direction) {
    const list = IMPORT_KEYWORDS[direction] || [];
    for (const [re, code] of list) if (re.test(label || '')) return code;
    return direction === 'in' ? '7-1000' : '6-1900';
}

// ─── "Catat Transaksi" — guided entry types ─────────────────────────────────
// The user picks WHAT happened; the system picks the accounts. Every type is
// one balanced entry posted to the journal, so all reports update at once.
//   group: in (uang masuk) | out (uang keluar) | transfer | noncash
//   counter: account on the other side of Kas/Bank
//   payable: when "Belum dibayar (utang)" is ticked, Cr this instead of Kas
//   unit: may be tagged to a vehicle (per-unit profitability)
//   other: user may choose a different counter account
export const QUICK_TYPES = [
    { key: 'sewa_tunai', group: 'in', label: 'Pendapatan sewa (tanpa invoice)', counter: '4-1000', unit: true,
      hint: 'Untuk sewa yang dibayar langsung tanpa invoice di sistem. Jika order punya invoice, catat pembayarannya di Rekap Order — jurnalnya otomatis.' },
    { key: 'jasa_driver', group: 'in', label: 'Pendapatan jasa driver', counter: '4-1100', unit: true },
    { key: 'lembur_inap', group: 'in', label: 'Pendapatan lembur & inap', counter: '4-1200', unit: true },
    { key: 'modal', group: 'in', label: 'Setoran modal pemilik', counter: '3-1000' },
    { key: 'pinjaman', group: 'in', label: 'Pencairan pinjaman / pembiayaan', counter: '2-2100' },
    { key: 'bunga', group: 'in', label: 'Bunga / jasa giro bank', counter: '7-1100' },
    { key: 'masuk_lain', group: 'in', label: 'Pemasukan lain-lain', counter: '7-1000', other: true },

    { key: 'bbm', group: 'out', label: 'BBM', counter: '5-1200', unit: true, payable: '2-1400' },
    { key: 'tol_parkir', group: 'out', label: 'Tol & parkir', counter: '5-1300', unit: true },
    { key: 'servis', group: 'out', label: 'Servis, oli, ban & perawatan', counter: '5-1400', unit: true, payable: '2-1100' },
    { key: 'pajak_kendaraan', group: 'out', label: 'Pajak kendaraan (STNK/KIR)', counter: '5-1500', unit: true },
    { key: 'asuransi', group: 'out', label: 'Asuransi kendaraan', counter: '5-1600', unit: true, payable: '2-1400' },
    { key: 'sewa_vendor', group: 'out', label: 'Sewa unit dari vendor', counter: '5-1000', unit: true, payable: '2-1100' },
    { key: 'driver', group: 'out', label: 'Upah / uang jalan driver', counter: '5-1100', unit: true, payable: '2-1200' },
    { key: 'gaji', group: 'out', label: 'Gaji karyawan', counter: '6-1000', payable: '2-1200' },
    { key: 'sewa_kantor', group: 'out', label: 'Sewa kantor', counter: '6-1100', payable: '2-1400' },
    { key: 'utilitas', group: 'out', label: 'Listrik, air, internet, pulsa', counter: '6-1200', payable: '2-1400' },
    { key: 'iklan', group: 'out', label: 'Iklan & promosi', counter: '6-1300', payable: '2-1400' },
    { key: 'atk', group: 'out', label: 'ATK & perlengkapan', counter: '6-1400' },
    { key: 'admin_bank', group: 'out', label: 'Biaya admin bank', counter: '6-1500' },
    { key: 'cicilan', group: 'out', label: 'Cicilan pokok pembiayaan kendaraan', counter: '2-2100',
      hint: 'Isi pokoknya saja. Bunga cicilan dicatat sebagai "Pengeluaran lain-lain" dengan akun Beban Lain-lain.' },
    { key: 'beli_kendaraan', group: 'out', label: 'Pembelian kendaraan', counter: '1-2100', unit: true, payable: '2-2100' },
    { key: 'bayar_utang', group: 'out', label: 'Bayar utang vendor / tagihan', counter: '2-1100', other: true },
    { key: 'prive', group: 'out', label: 'Pengambilan pribadi pemilik (prive)', counter: '3-2000' },
    { key: 'keluar_lain', group: 'out', label: 'Pengeluaran lain-lain', counter: '6-1900', other: true, unit: true, payable: '2-1400' },

    { key: 'transfer', group: 'transfer', label: 'Pindah dana antar Kas/Bank' },

    { key: 'penyusutan', group: 'noncash', label: 'Penyusutan kendaraan', debit: '5-1700', credit: '1-2110', unit: true,
      hint: 'Biasanya dicatat sekali sebulan per unit: harga beli ÷ umur manfaat (bulan).' },
];
export const QUICK_TYPE_BY_KEY = new Map(QUICK_TYPES.map((q) => [q.key, q]));

/**
 * Build balanced lines for a guided entry. Throws Error(message) on bad input.
 * accs: { idByCode: Map(code → id), cashIds: Set, ids: Set }
 * input: { amount, cashAccountId, toCashAccountId, counterAccountId, onCredit, carId, orderNumber, memo }
 */
export function buildQuickLines(type, input, accs) {
    const q = QUICK_TYPE_BY_KEY.get(type);
    if (!q) throw new Error('Jenis transaksi tidak dikenal.');
    const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
    if (!(amount > 0)) throw new Error('Jumlah harus lebih dari 0.');
    const tag = q.unit ? { carId: input.carId ? Number(input.carId) : null, orderNumber: input.orderNumber ? String(input.orderNumber).slice(0, 20) : null } : {};
    const memo = input.memo ? String(input.memo).slice(0, 300) : null;
    const need = (code) => {
        const id = accs.idByCode.get(code);
        if (!id) throw new Error(`Akun ${code} belum ada di Daftar Akun. Gunakan "Pakai Daftar Akun Standar".`);
        return id;
    };
    const cash = (id, label) => {
        const n = Number(id);
        if (!accs.cashIds.has(n)) throw new Error(`Pilih akun ${label} (Kas/Bank).`);
        return n;
    };
    const counter = () => {
        if (q.other && input.counterAccountId) {
            const n = Number(input.counterAccountId);
            if (!accs.ids.has(n) || accs.cashIds.has(n)) throw new Error('Akun lawan tidak valid.');
            return n;
        }
        return need(q.counter);
    };

    if (q.group === 'transfer') {
        const from = cash(input.cashAccountId, 'asal'), to = cash(input.toCashAccountId, 'tujuan');
        if (from === to) throw new Error('Akun asal dan tujuan harus berbeda.');
        return [{ accountId: to, debit: amount, credit: 0, memo }, { accountId: from, debit: 0, credit: amount, memo }];
    }
    if (q.group === 'noncash') {
        return [{ accountId: need(q.debit), debit: amount, credit: 0, memo, ...tag }, { accountId: need(q.credit), debit: 0, credit: amount, memo, ...tag }];
    }
    if (q.group === 'in') {
        return [{ accountId: cash(input.cashAccountId, 'penerima'), debit: amount, credit: 0, memo }, { accountId: counter(), debit: 0, credit: amount, memo, ...tag }];
    }
    // out
    const creditSide = input.onCredit && q.payable ? need(q.payable) : cash(input.cashAccountId, 'pembayar');
    return [{ accountId: counter(), debit: amount, credit: 0, memo, ...tag }, { accountId: creditSide, debit: 0, credit: amount, memo }];
}
