import 'dotenv/config';
import dns from 'node:dns';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { countQuery } from '../services/perf.service.js';

// Prefer IPv4. Neon's host resolves to both IPv6 and IPv4 addresses; on many
// networks (home Wi-Fi advertising IPv6 without a working route, some VPNs)
// Node tries the IPv6 address first and hangs until CONNECT_TIMEOUT instead of
// falling back. Forcing IPv4-first avoids that dead path. Harmless where IPv6
// works. Node 18+.
dns.setDefaultResultOrder('ipv4first');

const connectionString = process.env.DATABASE_URL;

// Connection resilience. Neon (esp. free tier) suspends/archives idle
// branches, so the first connection after idle races a cold start. Combined
// with the `-pooler` (PgBouncer, transaction mode) endpoint, the library
// defaults are too fragile: an unbounded connect wait turns a waking branch
// into a hard hang, and default prepared statements are not compatible with
// PgBouncer transaction pooling (they cause intermittent query errors even
// when the network is healthy). These options fix both.
//
//   connect_timeout  fail fast + clean instead of hanging ~20s on a cold DB
//   idle_timeout     drop idle sockets so a suspended compute leaves no stale
//                    connections that error on next use
//   max_lifetime     recycle long-lived sockets (pooler drops them anyway)
//   max              modest pool; the pooler multiplexes server-side
//   prepare: false   REQUIRED for the pooler endpoint; harmless on a direct one
//
// All values are correct for BOTH dev and prod / pooler and direct endpoints,
// so this ships unchanged everywhere — nothing environment-specific.
const client = postgres(connectionString, {
    connect_timeout: 15,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    max: 10,
    prepare: false,
    keep_alive: 15,   // TCP keep-alive (s): notice a silently dropped Neon socket sooner
});

// Logger: counts queries per request for the latency report (perf.service); prints them with DEBUG=true.
const DEBUG_SQL = process.env.DEBUG === 'true';
export const db = drizzle(client, {
    schema,
    logger: { logQuery(query, params) { countQuery(); if (DEBUG_SQL) console.log('[sql]', query, params); } },
});

// ─── Transient connection errors (Neon cold start / dropped socket) ─────────
// Neon closes idle sockets and suspends compute after a few idle minutes; the
// next query can then fail with ECONNRESET / CONNECTION_CLOSED. Those are
// retryable and must never crash the process.
const TRANSIENT = new Set([
    'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE',
    'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_DESTROYED', 'CONNECTION_ENDED', 'PING_TIMEOUT',
]);
export function isTransientDbError(err) {
    if (!err) return false;
    const codes = [err.code, err.errno, err.cause?.code, err.cause?.errno, ...(Array.isArray(err.errors) ? err.errors.map((e) => e?.code) : [])];
    return codes.some((c) => TRANSIENT.has(c));
}

/** Run fn, retrying transient connection errors (default 3 tries, 2 s apart). */
export async function withDbRetry(fn, { tries = 3, delayMs = 2000 } = {}) {
    let last;
    for (let i = 1; i <= tries; i++) {
        try { return await fn(); }
        catch (e) {
            last = e;
            if (!isTransientDbError(e) || i === tries) throw e;
            await new Promise((r) => setTimeout(r, delayMs * i));
        }
    }
    throw last;
}
