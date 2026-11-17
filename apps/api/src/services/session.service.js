// ─── Login session lock + idle timeout (owner 2026-11-13) ───────────────────
// Rules: session-core.js (pure, tested). This file does the I/O:
//   • beforeCreate — Better Auth hook when a login creates a session: refuse
//     ("pengguna online") while the user's other login is in use; allow a
//     take-over (X-Force-Login: 1) once that login has been idle 5 minutes.
//   • guard        — every authenticated request: end the session after its
//     idle timeout; real requests (not X-Background polling) count as activity.
//   • endedReason  — tells a browser WHY its session is gone (expired / kicked).
// last_seen_at is kept in memory per session and written to the DB at most every
// 30 s (single PM2 instance, like the other in-process caches).
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { session as sessionTable, sessionEnds, user as userTable } from '../db/schema.js';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { APIError } from 'better-auth/api';
import * as S from './session-core.js';
import { getAccess } from './access.service.js';

const seen = new Map();      // sessionId → { at: last activity ms, written: last DB write ms }
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/** Session token from a Cookie header ("better-auth.session_token=<token>.<signature>"). */
export function tokenFromCookie(cookieHeader = '') {
    const m = String(cookieHeader || '').match(/(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/);
    if (!m) return null;
    let v = m[1];
    try { v = decodeURIComponent(v); } catch { /* keep raw */ }
    const dot = v.lastIndexOf('.');
    return dot > 0 ? v.slice(0, dot) : v;
}

const headerOf = (ctx, name) => {
    const h = ctx?.headers || ctx?.request?.headers;
    if (!h) return null;
    return typeof h.get === 'function' ? h.get(name) : h[name] ?? h[name.toLowerCase()] ?? null;
};

async function policyFor(userId, userRow, userAgent, chMobile = null) {
    const access = await getAccess(userId).catch(() => null);
    return S.sessionPolicy({ user: userRow || { role: access?.role }, access, deviceType: S.deviceTypeOf(userAgent, chMobile) });
}

async function endSessions(rows, reason, { device = null } = {}) {
    if (!rows.length) return;
    await db.delete(sessionTable).where(inArray(sessionTable.id, rows.map((r) => r.id)));
    await db.insert(sessionEnds).values(rows.map((r) => ({ tokenHash: hashToken(r.token), userId: r.userId, reason, device })))
        .onConflictDoNothing().catch(() => {});
    for (const r of rows) seen.delete(r.id);
}

export const sessionService = {
    /** Better Auth databaseHooks.session.create.before — throws APIError to refuse the login. */
    async beforeCreate(newSession, ctx) {
        if (!ctx) return;                                   // internal call, not a login
        const userId = newSession.userId;
        const [u] = await db.select({ role: userTable.role }).from(userTable).where(eq(userTable.id, userId)).limit(1);
        const ua = newSession.userAgent || headerOf(ctx, 'user-agent') || '';
        const mine = await policyFor(userId, u, ua, headerOf(ctx, 'sec-ch-ua-mobile'));
        if (mine.exempt) return;
        // The same browser replacing its own session (2FA enable, password change) is not "another device".
        const ownToken = tokenFromCookie(headerOf(ctx, 'cookie'));
        const rows = (await db.select().from(sessionTable).where(and(eq(sessionTable.userId, userId), gt(sessionTable.expiresAt, new Date()))))
            .filter((r) => r.token !== ownToken);
        if (!rows.length) return;
        const others = [];
        for (const r of rows) {
            const p = await policyFor(userId, u, r.userAgent);
            const mem = seen.get(r.id)?.at;
            others.push({ id: r.id, token: r.token, userId, userAgent: r.userAgent, idleMinutes: p.idleMinutes, lastSeen: new Date(Math.max(mem || 0, new Date(r.lastSeenAt || r.updatedAt || r.createdAt).getTime())) });
        }
        const force = headerOf(ctx, 'x-force-login') === '1';
        const d = S.loginDecision({ others, force });
        if (!d.allow) {
            const at = new Date(d.holder.lastSeen).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
            const msg = d.code === 'USER_ONLINE_KICKABLE'
                ? `Pengguna online di perangkat lain (${d.holder.device}), tidak aktif ${d.idle} menit. Anda bisa mengeluarkan perangkat itu dan masuk di sini.`
                : `Pengguna online di perangkat lain (${d.holder.device}, terakhir aktif ${at} WIB). Anda bisa mengambil alih bila perangkat itu tidak aktif ${S.KICK_AFTER_IDLE_MINUTES} menit.`;
            throw new APIError('FORBIDDEN', { message: msg, code: d.code, holder: d.holder, idleMinutes: d.idle, kickableAt: d.kickableAt });
        }
        const gone = others.filter((o) => d.kick?.includes(o.id)).map((o) => ({ id: o.id, token: o.token, userId }));
        await endSessions(gone, d.kicked ? 'kicked' : 'expired', { device: S.deviceLabel(ua) });
    },

    /**
     * requireAuth: enforce the idle timeout and record activity.
     * → { ok: true, policy } | { ok: false, code: 'SESSION_EXPIRED' }
     */
    async guard(req, sessionData) {
        const s = sessionData.session, u = sessionData.user;
        const p = await policyFor(u.id, u, s.userAgent);
        if (p.exempt) return { ok: true, policy: p };
        const now = Date.now();
        let mem = seen.get(s.id);
        if (!mem) {
            const fromDb = s.lastSeenAt ?? (await db.select({ at: sessionTable.lastSeenAt }).from(sessionTable).where(eq(sessionTable.id, s.id)).limit(1))[0]?.at;
            const at = new Date(fromDb || s.updatedAt || s.createdAt || now).getTime();
            mem = { at, written: at };
            seen.set(s.id, mem);
        }
        if (!S.isAlive({ lastSeen: mem.at, idleMinutes: p.idleMinutes, now })) {
            await endSessions([{ id: s.id, token: s.token, userId: u.id }], 'expired');
            return { ok: false, code: 'SESSION_EXPIRED', policy: p };
        }
        const background = req.get?.('x-background') === '1';
        if (!background) {
            mem.at = now;
            if (now - mem.written > S.SEEN_WRITE_EVERY_MS) {
                mem.written = now;
                db.update(sessionTable).set({ lastSeenAt: new Date(now) }).where(eq(sessionTable.id, s.id)).catch(() => {});
            }
        }
        return { ok: true, policy: p, idleMinutes: Math.floor((now - mem.at) / 60000) };
    },

    /** Why this browser's session ended (null = never logged in / logged out). */
    async endedReason(cookieHeader) {
        const token = tokenFromCookie(cookieHeader);
        if (!token) return null;
        const [r] = await db.select().from(sessionEnds).where(eq(sessionEnds.tokenHash, hashToken(token))).limit(1);
        return r ? { reason: r.reason, device: r.device, at: r.at } : null;
    },

    /** 401 body for an ended session. */
    endedBody(end) {
        if (end?.reason === 'kicked') {
            return { error: `Anda dikeluarkan karena akun ini masuk dari perangkat lain${end.device ? ` (${end.device})` : ''}.`, code: 'SESSION_KICKED', device: end.device || null, at: end.at };
        }
        return { error: `Sesi Anda berakhir karena tidak aktif ${S.IDLE_MINUTES} menit. Silakan masuk lagi.`, code: 'SESSION_EXPIRED' };
    },

    /** Housekeeping: drop old reasons + memory of sessions not seen for a day. */
    async prune() {
        const dayAgo = Date.now() - 86400000;
        for (const [id, m] of seen) if (m.at < dayAgo) seen.delete(id);
        await db.delete(sessionEnds).where(lt(sessionEnds.at, new Date(Date.now() - 14 * 86400000))).catch(() => {});
    },
};

export default sessionService;
