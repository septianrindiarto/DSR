import dns from 'node:dns';
import postgres from 'postgres';
import dotenv from 'dotenv';

// Match the app: prefer IPv4 so a dead IPv6 route doesn't cause CONNECT_TIMEOUT.
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

const url = process.env.DATABASE_URL || '';

// Show which endpoint we're about to dial (credentials masked) so we can tell a
// pooler vs direct endpoint, wrong host, or missing sslmode at a glance.
try {
    const u = new URL(url);
    console.log('Target →', {
        host: u.hostname,
        port: u.port || '5432',
        db: u.pathname.slice(1),
        pooler: u.hostname.includes('-pooler'),
        sslmode: u.searchParams.get('sslmode') || '(none)',
    });
} catch {
    console.log('DATABASE_URL is', url ? 'present but unparseable' : 'EMPTY');
}

// connect_timeout keeps it from hanging ~20s like the app did.
const sql = postgres(url, { connect_timeout: 10 });

async function testConnection() {
    try {
        const result = await sql`SELECT NOW()`;
        console.log('✅ Database connected successfully!');
        console.log('Server time:', result[0].now);
    } catch (error) {
        console.error('❌ Connection failed');
        console.error('  message:', error.message || '(empty)');
        console.error('  code   :', error.code || error.errno || '(none)');
        if (error.cause) {
            console.error('  cause  :', error.cause.code || error.cause.message || String(error.cause));
        }
    } finally {
        await sql.end({ timeout: 5 }).catch(() => {});
        process.exit(0);
    }
}

testConnection();
