// ─── Login session rules — pure (owner 2026-11-13) ───────────────────────────
// • One live login per user ("pengguna online" flag). A second login from
//   another browser/device is refused while the first one is in use.
// • Idle timeout 15 minutes: no activity (clicks, typing, API use) for 15 min
//   → the session expires and the user is told so.
// • The second device may KICK the first one only after the first has been
//   idle for 5 minutes (still inside its 15-minute window).
// • Superadmin: exempt (no lock, normal 7-day session).
// • Drivers on a phone / tablet get a longer idle timeout (out on the road);
//   on a computer they follow the normal 15 minutes.
// No absolute daily limit. Background polling (notification bell) is NOT
// activity — only real use keeps a session alive.
// ─────────────────────────────────────────────────────────────────────────────

export const IDLE_MINUTES = 15;
export const DRIVER_MOBILE_IDLE_MINUTES = 12 * 60;
export const KICK_AFTER_IDLE_MINUTES = 5;
export const SEEN_WRITE_EVERY_MS = 30_000;   // last_seen_at is written at most every 30 s

/** 'mobile' | 'tablet' | 'desktop' from a User-Agent (+ optional Sec-CH-UA-Mobile). */
export function deviceTypeOf(userAgent = '', chMobile = null) {
    const ua = String(userAgent || '');
    if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
    if (chMobile === '?1' || /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|Opera Mini/i.test(ua)) return 'mobile';
    return 'desktop';
}

/** Short label for messages: "Chrome · Windows", "Safari · iPhone" … */
export function deviceLabel(userAgent = '') {
    const ua = String(userAgent || '');
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
        : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'perangkat lain';
    return `${browser} · ${os}`;
}

/** Driver accounts: driver-app role template, or only the driverapp.use permission. */
export function isDriverAccount({ templateKey = null, perms = null } = {}) {
    if (templateKey === 'sys:agency_driver') return true;
    const list = perms ? [...perms] : [];
    return list.length > 0 && list.every((p) => p === 'driverapp.use');
}

/**
 * Rules for one session. → { exempt, idleMinutes }
 * user: { role }, access: { templateKey, perms }, deviceType from deviceTypeOf().
 */
export function sessionPolicy({ user = {}, access = null, deviceType = 'desktop' } = {}) {
    if (user.role === 'superadmin') return { exempt: true, idleMinutes: null };
    const driver = isDriverAccount({ templateKey: access?.templateKey, perms: access?.perms });
    if (driver && (deviceType === 'mobile' || deviceType === 'tablet')) return { exempt: false, idleMinutes: DRIVER_MOBILE_IDLE_MINUTES };
    return { exempt: false, idleMinutes: IDLE_MINUTES };
}

/** Minutes a session has been idle (last real activity → now). */
export const idleMinutesOf = (lastSeen, now = Date.now()) => Math.max(0, (now - new Date(lastSeen).getTime()) / 60000);

/** Is the session still alive under its idle rule? */
export function isAlive({ lastSeen, idleMinutes, now = Date.now() }) {
    if (idleMinutes == null) return true;
    return idleMinutesOf(lastSeen, now) < idleMinutes;
}

/**
 * New login while other sessions of the same user exist.
 * others: [{ id, lastSeen, idleMinutes, userAgent }] (only sessions still alive count)
 * → { allow: true } | { allow: true, kick: [ids] } | { allow: false, code, holder, idle, kickableAt }
 *   code USER_ONLINE           — the other login is in use (idle < 5 min): wait
 *   code USER_ONLINE_KICKABLE  — idle ≥ 5 min: may be taken over (force)
 */
export function loginDecision({ others = [], force = false, now = Date.now() } = {}) {
    const alive = others.filter((o) => isAlive({ lastSeen: o.lastSeen, idleMinutes: o.idleMinutes, now }));
    if (!alive.length) return { allow: true, kick: others.map((o) => o.id) };   // stale ones are cleaned up too
    const latest = alive.reduce((a, b) => (new Date(a.lastSeen) > new Date(b.lastSeen) ? a : b));
    const idle = idleMinutesOf(latest.lastSeen, now);
    const kickableAt = new Date(new Date(latest.lastSeen).getTime() + KICK_AFTER_IDLE_MINUTES * 60000);
    const holder = { device: deviceLabel(latest.userAgent), lastSeen: new Date(latest.lastSeen).toISOString() };
    if (idle >= KICK_AFTER_IDLE_MINUTES) {
        if (force) return { allow: true, kick: others.map((o) => o.id), kicked: true };
        return { allow: false, code: 'USER_ONLINE_KICKABLE', holder, idle: Math.floor(idle), kickableAt: kickableAt.toISOString() };
    }
    return { allow: false, code: 'USER_ONLINE', holder, idle: Math.floor(idle), kickableAt: kickableAt.toISOString() };
}
