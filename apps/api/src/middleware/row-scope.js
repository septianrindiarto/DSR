// ─── Row-scope guard for by-id writes (cars, drivers, customers, maintenance) ─
// List endpoints were already org-scoped, but PUT/DELETE /:id updated any id.
// This guard re-uses the same buildScopeConditions() visibility the list uses:
// if the caller couldn't see the row in the list, they can't change it.
// Out-of-scope ids answer 404 so other tenants' ids don't leak.
import { db } from '../db/index.js';
import { and, eq, inArray } from 'drizzle-orm';
import { buildScopeConditions } from './scope.js';
import { customers } from '../db/schema.js';

function scopeOf(user, table) {
    return buildScopeConditions(user, {
        organizationId: table.organizationId, isDemo: table.isDemo, createdBy: table.createdBy,
        // customers: also those in orders the agency owns (see scope.js)
        ...(table === customers ? { customerId: customers.id } : {}),
    });
}

/** Guard `/:id` routes. */
export function requireRowScope(table, param = 'id') {
    return async (req, res, next) => {
        try {
            const id = Number(req.params[param]);
            if (!id) return res.status(400).json({ error: 'ID tidak valid' });
            const [row] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), ...scopeOf(req.user, table))).limit(1);
            if (!row) return res.status(404).json({ error: 'Data tidak ditemukan' });
            next();
        } catch (e) { next(e); }
    };
}

/** Guard bulk bodies (ids picked from req.body). Drops nothing silently: all-or-404. */
export function requireBodyRowScope(table, pick) {
    return async (req, res, next) => {
        try {
            const ids = [...new Set((pick(req.body || {}) || []).map(Number).filter(Boolean))];
            if (!ids.length) return next();
            const rows = await db.select({ id: table.id }).from(table).where(and(inArray(table.id, ids), ...scopeOf(req.user, table)));
            if (rows.length !== ids.length) return res.status(404).json({ error: 'Sebagian data tidak ditemukan atau di luar akses Anda.' });
            next();
        } catch (e) { next(e); }
    };
}
