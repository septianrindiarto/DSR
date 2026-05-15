import 'dotenv/config';
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);

async function migrate() {
    try {
        // ─── Extend journal_entries ─────────────────────────────────
        await sql`
            ALTER TABLE journal_entries
            ADD COLUMN IF NOT EXISTS is_reversal BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS reversal_of INTEGER REFERENCES journal_entries(id),
            ADD COLUMN IF NOT EXISTS journal_ref VARCHAR(20)
        `;
        console.log('✅ journal_entries columns added (is_reversal, reversal_of, journal_ref)');

        await sql`CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries(journal_ref)`;
        console.log('✅ Index on journal_ref created');

        // ─── Chart of Accounts ──────────────────────────────────────
        await sql`
            CREATE TABLE IF NOT EXISTS chart_of_accounts (
                id          SERIAL PRIMARY KEY,
                code        VARCHAR(20)  NOT NULL UNIQUE,
                name        VARCHAR(255) NOT NULL,
                type        VARCHAR(20)  NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
                normal_balance VARCHAR(10) NOT NULL CHECK (normal_balance IN ('debit','credit')),
                description TEXT,
                is_active   BOOLEAN      DEFAULT TRUE,
                created_at  TIMESTAMP    DEFAULT NOW(),
                updated_at  TIMESTAMP    DEFAULT NOW()
            )
        `;
        console.log('✅ chart_of_accounts table ready');

        // Seed standard CoA for rental business
        await sql`
            INSERT INTO chart_of_accounts (code, name, type, normal_balance, description) VALUES
            ('1-1000', 'Kas',                    'asset',     'debit',  'Uang tunai di tangan'),
            ('1-1100', 'Bank',                   'asset',     'debit',  'Rekening bank perusahaan'),
            ('1-1200', 'Piutang Usaha',           'asset',     'debit',  'Tagihan kepada pelanggan'),
            ('1-2000', 'Kendaraan',               'asset',     'debit',  'Aset kendaraan'),
            ('1-2100', 'Akumulasi Penyusutan',    'asset',     'credit', 'Penyusutan kendaraan'),
            ('2-1000', 'Hutang Usaha',            'liability', 'credit', 'Kewajiban kepada pemasok'),
            ('2-1100', 'Hutang Pajak',            'liability', 'credit', 'PPN dan PPh terutang'),
            ('3-1000', 'Modal',                   'equity',    'credit', 'Modal pemilik'),
            ('3-1100', 'Laba Ditahan',            'equity',    'credit', 'Laba tahun-tahun sebelumnya'),
            ('4-1000', 'Pendapatan Sewa',         'income',    'credit', 'Pendapatan dari penyewaan kendaraan'),
            ('4-1100', 'Pendapatan Sopir',        'income',    'credit', 'Pendapatan jasa sopir'),
            ('4-1200', 'Pendapatan Lain-lain',    'income',    'credit', 'Pendapatan di luar usaha utama'),
            ('5-1000', 'Beban BBM',               'expense',   'debit',  'Biaya bahan bakar'),
            ('5-1100', 'Beban Perawatan',         'expense',   'debit',  'Servis dan perbaikan kendaraan'),
            ('5-1200', 'Beban Gaji Sopir',        'expense',   'debit',  'Upah sopir'),
            ('5-1300', 'Beban Makan',             'expense',   'debit',  'Uang makan karyawan'),
            ('5-1400', 'Beban Asuransi',          'expense',   'debit',  'Premi asuransi kendaraan'),
            ('5-1500', 'Beban Administrasi',      'expense',   'debit',  'Biaya operasional kantor'),
            ('5-1600', 'Beban Penyusutan',        'expense',   'debit',  'Beban penyusutan kendaraan'),
            ('5-1900', 'Beban Lain-lain',         'expense',   'debit',  'Pengeluaran tidak terkategorikan')
            ON CONFLICT (code) DO NOTHING
        `;
        console.log('✅ Chart of Accounts seeded (20 accounts)');

        // ─── Locked Periods ─────────────────────────────────────────
        await sql`
            CREATE TABLE IF NOT EXISTS locked_periods (
                id        SERIAL PRIMARY KEY,
                year      INTEGER NOT NULL,
                month     INTEGER,                -- NULL = entire year locked
                locked_at TIMESTAMP DEFAULT NOW(),
                locked_by TEXT REFERENCES "user"(id),
                UNIQUE(year, month)
            )
        `;
        console.log('✅ locked_periods table ready');

        console.log('\n🎉 Finance v2 migration complete!');
    } catch (e) {
        console.error('❌ Error:', e.message);
        process.exit(1);
    } finally {
        await sql.end();
    }
}
migrate();
