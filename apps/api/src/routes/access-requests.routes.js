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

const router = Router();

const validFeatureKeys = Object.values(FEATURES);

const createSchema = z.object({
    featureKey: z.enum(validFeatureKeys, { message: 'Fitur tidak dikenal' }),
    note: z.string().max(500).optional().nullable(),
});

// ─── POST / — create a new request ────────────────────────────────────────
router.post('/', requireAuth, requireRole(ROLE_GROUPS.ANY_AUTHENTICATED),
    validate(createSchema), async (req, res, next) => {
    try {
        const { featureKey, note } = req.body;
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
router.get('/pending', requireAuth, requireRole(ROLE_GROUPS.AGENCY_STAFF), async (req, res, next) => {
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
            .where(eq(accessRequests.status, 'pending'))
            .orderBy(accessRequests.requestedAt);
        res.json(rows);
    } catch (err) { next(err); }
});

// ─── PUT /:id/approve ─────────────────────────────────────────────────────
// On approve: mark request as approved + flip the requester's
// user.permissions JSON to grant the feature. The permission key follows
// the pattern `grant_<feature>` so backend route guards and the frontend
// permission helper can check it as a per-user override.
router.put('/:id/approve', requireAuth, requireRole(ROLE_GROUPS.AGENCY_STAFF), async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });

        const [reqRow] = await db.select().from(accessRequests).where(eq(accessRequests.id, id)).limit(1);
        if (!reqRow) return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
        if (reqRow.status !== 'pending') {
            return res.status(409).json({ error: `Permintaan sudah ${reqRow.status === 'approved' ? 'disetujui' : 'ditolak'}.` });
        }

        // 1. Mark request approved
        const [updated] = await db.update(accessRequests)
            .set({ status: 'approved', decidedBy: req.user.id, decidedAt: new Date() })
            .where(eq(accessRequests.id, id))
            .returning();

        // 2. Flip the requester's permissions JSON. Use Postgres jsonb_set so
        //    we don't clobber other existing flags on the same row.
        const permKey = `grant_${reqRow.featureKey}`;
        await db.execute(sql`
            UPDATE "user"
            SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), ${'{' + permKey + '}'}, 'true'::jsonb, true)
            WHERE id = ${reqRow.userId}
        `);

        res.json(updated);
    } catch (err) { next(err); }
});

// ─── PUT /:id/reject ──────────────────────────────────────────────────────
router.put('/:id/reject', requireAuth, requireRole(ROLE_GROUPS.AGENCY_STAFF), async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });

        const [reqRow] = await db.select().from(accessRequests).where(eq(accessRequests.id, id)).limit(1);
        if (!reqRow) return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
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
