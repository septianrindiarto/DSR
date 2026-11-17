// ─── In-app notifications (owner 2026-11-13) ────────────────────────────────
// Per user and privilege based: a notification targets an organisation and is
// optionally narrowed to one permission (only users holding it see it) or to
// one person. Shown in the header bell and on the dashboard; read state per
// user. notify() can also e-mail the same audience and ping Telegram.
// Rules for "who sees what" live in visibleTo() — keep them in one place.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import { notifications, notificationReads, user as userTable } from '../db/schema.js';
import { and, eq, inArray, desc, or, isNull, gte } from 'drizzle-orm';
import { getAccess, hasPerm } from './access.service.js';
import { sendEmail } from './email.service.js';
import { notifyAdmin } from './telegram.service.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const appUrl = () => process.env.APP_URL || 'http://localhost:5173';
const KEEP_DAYS = 120;

/** Organisation admin (agency or client). */
export const isOrgAdmin = (user, access) => user.role === 'superadmin' || user.role === 'admin' || user.role === 'client_admin'
    || access?.templateKey === 'sys:agency_admin' || access?.templateKey === 'sys:client_admin';

/** Can this user see this notification? (access = getAccess result) */
export function visibleTo(n, user, access) {
    if (n.userId) return n.userId === user.id;
    if (user.role === 'superadmin') return true;
    if (!n.organizationId || n.organizationId !== user.organizationId) return false;
    if (!n.perm) return true;
    if (n.perm === 'admin') return isOrgAdmin(user, access);
    return hasPerm(access, n.perm);
}

/** People of an org who would see a notification (for e-mail). */
async function audience(orgId, perm, userId) {
    if (userId) return db.select({ id: userTable.id, email: userTable.email, name: userTable.name }).from(userTable).where(eq(userTable.id, userId)).limit(1);
    if (!orgId) return [];
    const list = await db.select({ id: userTable.id, email: userTable.email, name: userTable.name, role: userTable.role, organizationId: userTable.organizationId })
        .from(userTable).where(and(eq(userTable.organizationId, orgId), eq(userTable.isActive, true))).limit(80);
    const out = [];
    for (const u of list) {
        if (!u.email) continue;
        if (visibleTo({ organizationId: orgId, perm }, u, await getAccess(u.id))) out.push(u);
    }
    return out;
}

export const notificationService = {
    /**
     * Store one notification per target ({ orgId, perm?, userId? } or a list),
     * optionally e-mail the audience / ping Telegram. Never throws.
     */
    async notify({ targets, kind, severity = 'info', title, body = null, link = null, ref = null, createdBy = null, email = false, telegram = false }) {
        try {
            const list = (Array.isArray(targets) ? targets : [targets]).filter((x) => x && (x.orgId || x.userId));
            for (const tg of list) {
                await db.insert(notifications).values({
                    organizationId: tg.orgId || null, userId: tg.userId || null, perm: tg.perm || null,
                    kind: String(kind).slice(0, 30), severity, title: String(title).slice(0, 200), body, link, ref: ref ? String(ref).slice(0, 60) : null, createdBy,
                });
                if (email) {
                    for (const p of await audience(tg.orgId, tg.perm, tg.userId)) {
                        await sendEmail({
                            to: p.email, subject: title,
                            html: `<p>Halo ${esc(p.name)},</p><p>${esc(body || title)}</p>${link ? `<p><a href="${appUrl()}${link}">Buka di DSR</a></p>` : ''}`,
                            text: `${title}\n${body || ''}${link ? `\n${appUrl()}${link}` : ''}`,
                        }).catch(() => {});
                    }
                }
            }
            if (telegram) notifyAdmin(`${severity === 'urgent' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️'} <b>${esc(title)}</b>${body ? `\n${esc(body)}` : ''}`, { parseMode: 'HTML', disablePreview: true }).catch(() => {});
        } catch (e) { console.warn('[notify] failed:', e.message); }
    },

    /** Feed for the bell / dashboard (newest first). */
    async feed(user, { limit = 30, unreadOnly = false } = {}) {
        const access = await getAccess(user.id);
        const since = new Date(Date.now() - KEEP_DAYS * 86400000);
        const conds = [gte(notifications.createdAt, since)];
        if (user.role !== 'superadmin') conds.push(or(eq(notifications.userId, user.id), and(isNull(notifications.userId), eq(notifications.organizationId, user.organizationId || -1))));
        const rows = await db.select().from(notifications).where(and(...conds)).orderBy(desc(notifications.createdAt)).limit(400);
        const mine = rows.filter((n) => visibleTo(n, user, access));
        const ids = mine.map((n) => n.id);
        const read = ids.length ? new Set((await db.select({ id: notificationReads.notificationId }).from(notificationReads)
            .where(and(eq(notificationReads.userId, user.id), inArray(notificationReads.notificationId, ids)))).map((r) => r.id)) : new Set();
        const all = mine.map((n) => ({ id: n.id, kind: n.kind, severity: n.severity, title: n.title, body: n.body, link: n.link, ref: n.ref, at: n.createdAt, read: read.has(n.id) }));
        const unread = all.filter((n) => !n.read).length;
        return { data: (unreadOnly ? all.filter((n) => !n.read) : all).slice(0, Math.min(100, Number(limit) || 30)), unread };
    },

    async markRead(user, ids = null) {
        let list = Array.isArray(ids) ? ids.map(Number).filter(Boolean) : null;
        if (!list) list = (await this.feed(user, { limit: 100, unreadOnly: true })).data.map((n) => n.id);
        if (!list.length) return { read: 0 };
        await db.insert(notificationReads).values(list.map((id) => ({ notificationId: id, userId: user.id }))).onConflictDoNothing();
        return { read: list.length };
    },
};

export default notificationService;
