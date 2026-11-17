// ─── Permission guards (RBAC v2) ─────────────────────────────────────────────
// Use AFTER requireAuth. Each guard loads the caller's effective permissions
// (cached, see access.service.js), attaches them as req.access, and answers
// 403 when the permission is missing. This replaces the old role-only checks
// (requireAdmin), which let any "admin" — including client admins — reach
// agency-only APIs.
import { getAccess, hasPerm } from '../services/access.service.js';

async function load(req) {
    if (!req.access) req.access = await getAccess(req.user.id);
    return req.access;
}

const deny = (res, perm) => res.status(403).json({ error: 'Anda tidak memiliki hak akses untuk tindakan ini.', code: 'PERMISSION_DENIED', permission: perm });

/** requirePerm('orders', 'edit') */
export function requirePerm(feature, action) {
    const perm = `${feature}.${action}`;
    return async (req, res, next) => {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const a = await load(req);
            if (!hasPerm(a, perm)) return deny(res, perm);
            next();
        } catch (e) { next(e); }
    };
}

/** Any one of several permissions, e.g. driver list used by both Driver and Rekap. */
export function requireAnyPerm(...perms) {
    return async (req, res, next) => {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const a = await load(req);
            if (!perms.some((p) => hasPerm(a, p))) return deny(res, perms.join(' | '));
            next();
        } catch (e) { next(e); }
    };
}
