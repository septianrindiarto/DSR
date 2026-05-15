import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL);

async function resetDB() {
    console.log('🗑️  Dropping all existing tables...');
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
    await sql`GRANT ALL ON SCHEMA public TO neondb_owner`;
    await sql`GRANT ALL ON SCHEMA public TO public`;
    console.log('✅ Schema reset complete');
    process.exit(0);
}

resetDB().catch(e => { console.error(e); process.exit(1); });
