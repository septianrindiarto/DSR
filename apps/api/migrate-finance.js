import 'dotenv/config';
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);

async function migrate() {
    try {
        // Create enums
        await sql`DO $$ BEGIN
            CREATE TYPE fin_category AS ENUM ('keuangan_inti','perpajakan','aset_armada','kepatuhan','operasional','payroll');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
        console.log('✅ fin_category enum ready');

        await sql`DO $$ BEGIN
            CREATE TYPE fin_status AS ENUM ('draft','submitted','final','archived');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
        console.log('✅ fin_status enum ready');

        // Create table
        await sql`CREATE TABLE IF NOT EXISTS financial_reports (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            category fin_category NOT NULL DEFAULT 'keuangan_inti',
            period VARCHAR(100),
            status fin_status DEFAULT 'draft',
            file_url TEXT,
            file_type VARCHAR(20),
            notes TEXT,
            created_by TEXT REFERENCES "user"(id),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )`;
        console.log('✅ financial_reports table ready');
        console.log('\n🎉 Migration complete!');
    } catch (e) {
        console.error('❌ Error:', e.message);
    } finally {
        await sql.end();
    }
}
migrate();
