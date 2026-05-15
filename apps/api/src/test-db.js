import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL);

async function testConnection() {
    try {
        const result = await sql`SELECT NOW()`;
        console.log('✅ Database connected successfully!');
        console.log('Server time:', result[0].now);
        await sql.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Connection failed:', error.message);
        process.exit(1);
    }
}

testConnection();