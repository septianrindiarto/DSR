// ─── /api/orgs ────────────────────────────────────────────────────────────
// Phase 4A endpoints for the calling user's own organization.
//
//   GET    /my-invite-code           — return the current org's invite code
//                                       (admin only, scoped to their own org)
//   POST   /my-invite-code/resend    — re-email the code to the admin
//   POST   /my-invite-code/rotate    — generate a NEW code (old code stops
//                                       working; existing members unaffected)

import { Router } from 'express';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLE_GROUPS } from '../services/permissions.service.js';
import { generateUniqueInviteCode } from '../services/invite-code.service.js';
import { sendInviteCodeEmail } from '../services/email.service.js';

const router = Router();

// Helper — load the caller's org row and verify they're its admin.
async function loadCallerOrgIfAdmin(req, res) {
    if (!req.user?.organizationId) {
        res.status(404).json({ error: 'Akun Anda tidak terhubung ke perusahaan manapun.' });
        return null;
    }
    const [org] = await db.select()
        .from(organizations)
        .where(eq(organizations.id, req.user.organizationId))
        .limit(1);
    if (!org) {
        res.status(404).json({ error: 'Perusahaan tidak ditemukan.' });
        return null;
    }
    if (org.adminUserId !== req.user.id) {
        res.status(403).json({ error: 'Hanya admin perusahaan yang dapat mengelola data ini.' });
        return null;
    }
    return org;
}

// Same loader but read-only — any org member can call (no admin check).
async function loadCallerOrg(req, res) {
    if (!req.user?.organizationId) {
        res.status(404).json({ error: 'Akun Anda tidak terhubung ke perusahaan manapun.' });
        return null;
    }
    const [org] = await db.select()
        .from(organizations)
        .where(eq(organizations.id, req.user.organizationId))
        .limit(1);
    if (!org) {
        res.status(404).json({ error: 'Perusahaan tidak ditemukan.' });
        return null;
    }
    return org;
}

// ─── /my-info — company header info (Phase 4B) ───────────────────────────
// GET is open to any org member (they can SEE their company's profile).
// PUT is restricted to the org admin.
router.get('/my-info', requireAuth, requireRole(ROLE_GROUPS.ANY_AUTHENTICATED), async (req, res, next) => {
    try {
        const org = await loadCallerOrg(req, res);
        if (!org) return;
        res.json({
            id: org.id,
            displayId: org.displayId || null,
            name: org.name,
            address: org.address || '',
            phone1: org.phone1 || '',
            phone2: org.phone2 || '',
            email: org.email || '',
            signatory: org.signatory || '',
            brand: org.brand || '',
            npwp: org.npwp || '',
            isCallerAdmin: org.adminUserId === req.user.id,
        });
    } catch (err) { next(err); }
});

router.put('/my-info', requireAuth, requireRole(ROLE_GROUPS.ANY_AUTHENTICATED), async (req, res, next) => {
    try {
        const org = await loadCallerOrgIfAdmin(req, res);
        if (!org) return;
        const allowed = ['name', 'address', 'phone1', 'phone2', 'email', 'signatory', 'brand', 'npwp'];
        const patch = { updatedAt: new Date() };
        for (const k of allowed) {
            if (req.body[k] !== undefined) patch[k] = req.body[k];
        }
        // If name changes, also refresh name_normalized so soft-dup checks stay correct.
        if (patch.name) {
            patch.nameNormalized = String(patch.name).toLowerCase().replace(/\s+/g, ' ').trim();
        }
        const [updated] = await db.update(organizations)
            .set(patch)
            .where(eq(organizations.id, org.id))
            .returning();
        res.json({
            id: updated.id,
            displayId: updated.displayId || null,
            name: updated.name,
            address: updated.address || '',
            phone1: updated.phone1 || '',
            phone2: updated.phone2 || '',
            email: updated.email || '',
            signatory: updated.signatory || '',
            brand: updated.brand || '',
            npwp: updated.npwp || '',
            message: 'Informasi perusahaan tersimpan.',
        });
    } catch (err) { next(err); }
});

// GET /api/orgs/my-invite-code
router.get('/my-invite-code', requireAuth, requireRole(ROLE_GROUPS.ANY_AUTHENTICATED), async (req, res, next) => {
    try {
        const org = await loadCallerOrgIfAdmin(req, res);
        if (!org) return;
        res.json({
            organizationId: org.id,
            companyName: org.name,
            displayId: org.displayId || null,
            inviteCode: org.inviteCode,
        });
    } catch (err) { next(err); }
});

// POST /api/orgs/my-invite-code/resend
router.post('/my-invite-code/resend', requireAuth, requireRole(ROLE_GROUPS.ANY_AUTHENTICATED), async (req, res, next) => {
    try {
        const org = await loadCallerOrgIfAdmin(req, res);
        if (!org) return;
        if (!org.inviteCode) {
            return res.status(409).json({ error: 'Kode undangan belum dibuat. Coba rotasi kode terlebih dulu.' });
        }
        await sendInviteCodeEmail({
            to: req.user.email,
            adminName: req.user.name,
            companyName: org.name,
            inviteCode: org.inviteCode,
        });
        res.json({ message: 'Kode undangan telah dikirim ulang ke email Anda.' });
    } catch (err) { next(err); }
});

// POST /api/orgs/my-invite-code/rotate
router.post('/my-invite-code/rotate', requireAuth, requireRole(ROLE_GROUPS.ANY_AUTHENTICATED), async (req, res, next) => {
    try {
        const org = await loadCallerOrgIfAdmin(req, res);
        if (!org) return;
        const newCode = await generateUniqueInviteCode();
        await db.update(organizations)
            .set({ inviteCode: newCode })
            .where(eq(organizations.id, org.id));
        // Send the new code to the admin's email so it's also archived there.
        sendInviteCodeEmail({
            to: req.user.email,
            adminName: req.user.name,
            companyName: org.name,
            inviteCode: newCode,
        }).catch(() => { /* logged inside */ });
        res.json({
            organizationId: org.id,
            companyName: org.name,
            inviteCode: newCode,
            message: 'Kode undangan baru berhasil dibuat. Kode lama tidak berlaku lagi.',
        });
    } catch (err) { next(err); }
});

export default router;
