import 'dotenv/config';
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);

async function migrate() {
    try {
        await sql`CREATE TABLE IF NOT EXISTS journal_entries (
            id SERIAL PRIMARY KEY,
            entry_date TIMESTAMP NOT NULL,
            month INTEGER,
            description VARCHAR(500) NOT NULL,
            category VARCHAR(100) NOT NULL,
            debit DECIMAL(15,2) DEFAULT 0,
            credit DECIMAL(15,2) DEFAULT 0,
            reference VARCHAR(100),
            batch_id VARCHAR(50),
            created_at TIMESTAMP DEFAULT NOW()
        )`;
        console.log('✅ journal_entries table ready');

        await sql`CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(entry_date)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_journal_category ON journal_entries(category)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_journal_batch ON journal_entries(batch_id)`;
        console.log('✅ Indexes created');

        console.log('\n🎉 Migration complete!');
    } catch (e) {
        console.error('❌ Error:', e.message);
    } finally {
        await sql.end();
    }
}
migrate();
