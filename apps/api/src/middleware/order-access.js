// ─── Order write-access guards ───────────────────────────────────────────────
// Every order MUTATION must pass two checks (reads are scoped in the services):
//   1. client accounts are read-only on Rekap Order (superadmin exempt);
//   2. the target rows must be visible to the caller under the same scope as
//      Rekap Order (own org + orders claimed by my agency; superadmin = all).
// Out-of-scope ids answer 404 (not 403) so ids of other tenants don't leak.
import { db } from '../db/index.js';
import { orders } from '../db/schema.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildScopeConditions } from './scope.js';

function scopeFor(user) {
    return buildScopeConditions(user, {
        organizationId: orders.organizationId,
        isDemo: orders.isDemo,
        createdBy: orders.createdBy,
        claimedByAgencyId: orders.claimedByAgencyId,
    });
}

const isClientWriter = (u) => u && u.role !== 'superadmin' && u.accountType === 'client';

/** Block client accounts from mutating orders. */
export function denyClientOrderWrites(req, res, next) {
    if (isClientWriter(req.user)) {
        return res.status(403).json({ error: 'Akun client tidak dapat mengubah order.' });
    }
    next();
}

/** True when every id in `ids` is inside the caller's scope. */
export async function canAccessOrderIds(user, ids) {
    const uniq = [...new Set((ids || []).map(Number).filter(Boolean))];
    if (!uniq.length) return false;
    const rows = await db.select({ id: orders.id }).from(orders)
        .where(and(inArray(orders.id, uniq), ...scopeFor(user)));
    return rows.length === uniq.length;
}

/** True when the booking exists and ALL its rows are inside the caller's scope. */
export async function canAccessBooking(user, orderNumber) {
    if (!orderNumber) return false;
    const [all] = await db.select({ n: sql`COUNT(*)::int` }).from(orders)
        .where(eq(orders.orderNumber, orderNumber));
    if (!all?.n) return false;
    const [mine] = await db.select({ n: sql`COUNT(*)::int` }).from(orders)
        .where(and(eq(orders.orderNumber, orderNumber), ...scopeFor(user)));
    return Number(mine?.n) === Number(all.n);
}

const notFound = (res) => res.status(404).json({ error: 'Order tidak ditemukan' });

/** Guard for routes with :id. */
export async function requireOrderAccess(req, res, next) {
    try {
        if (!(await canAccessOrderIds(req.user, [req.params.id]))) return notFound(res);
        next();
    } catch (e) { next(e); }
}

/** Guard for routes with :orderNumber. */
export async function requireBookingAccess(req, res, next) {
    try {
        if (!(await canAccessBooking(req.user, req.params.orderNumber))) {
            return res.status(404).json({ error: 'Booking tidak ditemukan.' });
        }
        next();
    } catch (e) { next(e); }
}

/** Guard for bulk bodies: ids read by `pick(req.body)`. */
export function requireBodyOrderAccess(pick) {
    return async (req, res, next) => {
        try {
            const ids = pick(req.body || {});
            if (!(await canAccessOrderIds(req.user, ids))) {
                return res.status(404).json({ error: 'Sebagian order tidak ditemukan atau di luar akses Anda.' });
            }
            next();
        } catch (e) { next(e); }
    };
}
