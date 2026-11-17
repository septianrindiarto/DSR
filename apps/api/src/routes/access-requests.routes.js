// ─── /api/access-requests ─────────────────────────────────────────────────
// Phase 3 — clients ask for access to features their role doesn't grant.
//
// Endpoints:
//   POST   /                  — any logged-in user creates a request for themselves
//   GET    /pending           — admin lists pending requests (queue)
//   PUT    /:id/approve       — admin approves → flips user.permissions JSON
//   PUT    /:id/reject        — admin rejects → just updates status

import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { accessRequests, user as userTable } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLE_GROUPS, FEATURES } from '../services/permissions.service.js';
import { validate } from '../middleware/validate.js';
import { getAccess, invalidateUser } from '../services/access.service.js';
import { canAssign, CLIENT_ALLOWED } from '../services/access-core.js';
import { permissionAudit } from '../db/schema.js';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';

const router = Router();

// Requestable features = the legacy list + the RBAC v2 features added later.
// Each maps to the single permission an approval grants (menu "view" level).
const PERM_FOR_FEATURE = {
    ...Object.fromEntries(Object.values(FEATURES).map((f) => [f, `${f}.view`])),
    access_requests: 'orders.claim',
    pricing: 'pricing.view',
    corporate: 'corporate.view',
    contracts: 'contracts.view',
    opsrecap: 'opsrecap.view',
    contracthub: 'contracts.view', // Kontrak & Perusahaan menu (RoleGate passes this key)
    fleetcare: 'fleet.view',
};
const permForFeature = (f) => PERM_FOR_FEATURE[f] || `${f}.view`;
const validFeatureKeys = Object.keys(PERM_FOR_FEATURE);

const createSchema = z.object({
    featureKey: z.enum(validFeatureKeys, { message: 'Fitur tidak dikenal' }),
    note: z.string().max(500).optional().nullable(),
});

// ─── POST / — create a new request ────────────────────────────────────────
router.post('/', requireAuth, requireRole(ROLE_GROUPS.ANY_AUTHENTICATED),
    validate(createSchema), async (req, res, next) => {
    try {
        const { featureKey, note } = req.body;
        // Clients can never get agency-only features (rule R-01) — refuse up front
        // instead of leaving a request no admin is allowed to approve.
        const me = await getAccess(req.user.id);
        if (me?.accountType === 'client' && !CLIENT_ALLOWED.has(permForFeature(featureKey))) {
            return res.status(400).json({ error: 'Fitur ini tidak tersedia untuk akun klien.' });
        }
        // Block duplicates — if user already has a pending request for this
        // feature, surface that instead of creating a new row.
        const [dup] = await db.select({ id: accessRequests.id })
            .from(accessRequests)
            .where(and(
                eq(accessRequests.userId, req.user.id),
                eq(accessRequests.featureKey, featureKey),
                eq(accessRequests.status, 'pending')
            ))
            .limit(1);
        if (dup) {
            return res.status(409).json({
                error: 'Anda sudah mengirim permintaan untuk fitur ini. Tunggu konfirmasi admin.',
                requestId: dup.id,
            });
        }
        const [row] = await db.insert(accessRequests).values({
            userId: req.user.id,
            featureKey,
            note: note || null,
        }).returning();
        res.status(201).json(row);
    } catch (err) { next(err); }
});

// ─── GET /pending — admin queue ───────────────────────────────────────────
router.get('/pending', requireAuth, requirePerm('users', 'edit'), async (req, res, next) => {
    try {
        // Join with user to surface requester name + email in the queue.
        const rows = await db.select({
            id: accessRequests.id,
            userId: accessRequests.userId,
            featureKey: accessRequests.featureKey,
            status: accessRequests.status,
            note: accessRequests.note,
            requestedAt: accessRequests.requestedAt,
            userName: userTable.name,
            userEmail: userTable.email,
            userRole: userTable.role,
        })
            .from(accessRequests)
            .leftJoin(userTable, eq(accessRequests.userId, userTable.id))
            // Only requests from the approver's own organization (superadmin: all).
            .where(req.user.role === 'superadmin'
                ? eq(accessRequests.status, 'pending')
                : and(eq(accessRequests.status, 'pending'), eq(userTable.organizationId, req.user.organizationId || -1)))
            .orderBy(accessRequests.requestedAt);
        res.json(rows);
    } catch (err) { next(err); }
});

// ─── PUT /:id/approve ─────────────────────────────────────────────────────
// On approve: mark request as approved + flip the requester's
// user.permissions JSON to grant the feature. The permission key follows
// the pattern `grant_<feature>` so backend route guards and the frontend
// permission helper can check it as a per-user override.
router.put('/:id/approve', requireAuth, requirePerm('users', 'edit'), async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });

        const [reqRow] = await db.select().from(accessRequests).where(eq(accessRequests.id, id)).limit(1);
        if (!reqRow) return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
        if (reqRow.status !== 'pending') {
            return res.status(409).json({ error: `Permintaan sudah ${reqRow.status === 'approved' ? 'disetujui' : 'ditolak'}.` });
        }
        // RBAC v2: approver must be in the requester's org and may only grant
        // what they hold themselves; clients stay within the client cap.
        const target = await getAccess(reqRow.userId);
        if (!target) return res.status(404).json({ error: 'Pemohon tidak ditemukan' });
        if (req.user.role !== 'superadmin' && target.organizationId !== req.user.organizationId) {
            return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
        }
        const perm = permForFeature(reqRow.featureKey);
        const actor = await getAccess(req.user.id);
        const chk = canAssign({ actorRole: actor.role, actorAccountType: actor.accountType, actorPerms: actor.perms, targetAccountType: target.accountType, targetPerms: new Set([perm]) });
        if (!chk.ok) return res.status(403).json({ error: chk.reason });

        // 1. Mark request approved
        const [updated] = await db.update(accessRequests)
            .set({ status: 'approved', decidedBy: req.user.id, decidedAt: new Date() })
            .where(eq(accessRequests.id, id))
            .returning();

        // 2. Add the permission to the requester's grants (deduplicated).
        await db.execute(sql`
            UPDATE "user"
            SET perm_grants = (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb)
                               FROM jsonb_array_elements_text(COALESCE(perm_grants, '[]'::jsonb) || ${JSON.stringify([perm])}::jsonb) AS x),
                updated_at = NOW()
            WHERE id = ${reqRow.userId}
        `);
        invalidateUser(reqRow.userId);
        await db.insert(permissionAudit).values({
            organizationId: target.organizationId, actorId: req.user.id, targetUserId: reqRow.userId,
            action: 'access_request.approve', after: { granted: perm, requestId: id },
        });

        res.json(updated);
    } catch (err) { next(err); }
});

// ─── PUT /:id/reject ──────────────────────────────────────────────────────
router.put('/:id/reject', requireAuth, requirePerm('users', 'edit'), async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });

        const [reqRow] = await db.select().from(accessRequests).where(eq(accessRequests.id, id)).limit(1);
        if (!reqRow) return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
        if (req.user.role !== 'superadmin') {
            const t = await getAccess(reqRow.userId);
            if (!t || t.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
        }
        if (reqRow.status !== 'pending') {
            return res.status(409).json({ error: `Permintaan sudah ${reqRow.status === 'approved' ? 'disetujui' : 'ditolak'}.` });
        }

        const [updated] = await db.update(accessRequests)
            .set({ status: 'rejected', decidedBy: req.user.id, decidedAt: new Date() })
            .where(eq(accessRequests.id, id))
            .returning();

        res.json(updated);
    } catch (err) { next(err); }
});

export default router;
