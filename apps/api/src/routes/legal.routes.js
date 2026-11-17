// ─── /api/orgs/legal — agency legal documents (RBAC v2 onboarding) ───────────
// Required to leave "setup" mode: NIB (number + file), Akta Pendirian / SK
// Kemenkumham (file), NPWP Badan (number + file), KTP Penanggung Jawab (file),
// company phone. Once complete the agency becomes 'active' automatically.
//
// Privacy: files are stored OUTSIDE the public /uploads static folder
// (uploads-private/legal/<orgId>/) and are only streamed through the
// authenticated GET /file/:doc endpoint to members of that organization
// (or superadmin). KTP scans are personal data — never publicly linkable.
import { Router } from 'express';
import { auditRead } from '../middleware/logger.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requirePerm } from '../middleware/permission.js';
import { accessService, getAccess } from '../services/access.service.js';
import { LEGAL_DOCS, legalComplete } from '../services/access-core.js';
import { encryptedDiskStorage, sendFileDecrypted } from '../services/private-files.js';
import { encryptField, decryptField } from '../services/crypto.service.js';

const router = Router();
const ROOT = path.join(process.cwd(), 'uploads-private', 'legal');
const ALLOWED = /\.(pdf|jpe?g|png)$/i;

const upload = multer({
    storage: encryptedDiskStorage({
        destination: (req, _file, cb) => {
            const dir = path.join(ROOT, String(req.legalOrgId));
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => cb(null, `${req.params.doc}-${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = ALLOWED.test(file.originalname) && /^(application\/pdf|image\/(jpeg|png))$/.test(file.mimetype);
        cb(ok ? null : Object.assign(new Error('Hanya PDF, JPG, atau PNG (maks 10 MB).'), { status: 400 }), ok);
    },
});

// Caller's agency org (agency accounts only).
async function agencyOrg(req, res, next) {
    try {
        const a = await getAccess(req.user.id);
        if (a.accountType !== 'agency' || !a.organizationId) return res.status(403).json({ error: 'Hanya untuk akun agency.' });
        req.legalOrgId = a.organizationId;
        next();
    } catch (e) { next(e); }
}

function view(o) {
    const docs = o.legalDocs || {};
    return {
        legalStatus: o.legalStatus, nib: decryptField(o.nib) || '', npwp: decryptField(o.npwp) || '', phone: o.phone1 || '',
        documents: Object.fromEntries(LEGAL_DOCS.map((k) => [k, docs[k] ? { uploadedAt: docs[k].uploadedAt, originalName: docs[k].originalName } : null])),
        complete: legalComplete(o),
        missing: [
            ...LEGAL_DOCS.filter((k) => !docs[k]?.url),
            ...(!String(o.nib || '').trim() ? ['nibNumber'] : []),
            ...(!String(o.npwp || '').trim() ? ['npwpNumber'] : []),
            ...(!String(o.phone1 || '').trim() ? ['phone'] : []),
        ],
    };
}
async function loadOrg(id) {
    const [o] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    return o;
}

router.use(requireAuth, agencyOrg);

router.get('/', requirePerm('settings', 'view'), async (req, res, next) => {
    try { res.json(view(await loadOrg(req.legalOrgId))); } catch (e) { next(e); }
});

router.put('/', requirePerm('settings', 'edit'), async (req, res, next) => {
    try {
        const { nib, npwp, phone } = req.body || {};
        const patch = { updatedAt: new Date() };
        // NIB & NPWP are stored AES-256-GCM encrypted (crypto.service).
        if (nib !== undefined) patch.nib = encryptField(String(nib || '').replace(/\D/g, '').slice(0, 30) || null);
        if (npwp !== undefined) patch.npwp = encryptField(String(npwp || '').trim().slice(0, 30) || null);
        if (phone !== undefined) patch.phone1 = String(phone || '').trim().slice(0, 50) || null;
        await db.update(organizations).set(patch).where(eq(organizations.id, req.legalOrgId));
        await accessService.refreshLegalStatus(req.legalOrgId);
        res.json(view(await loadOrg(req.legalOrgId)));
    } catch (e) { next(e); }
});

router.post('/file/:doc', requirePerm('settings', 'edit'), (req, res, next) => {
    if (!LEGAL_DOCS.includes(req.params.doc)) return res.status(400).json({ error: 'Jenis dokumen tidak dikenal.' });
    upload.single('file')(req, res, async (err) => {
        if (err) return res.status(err.status || 400).json({ error: err.message });
        try {
            if (!req.file) return res.status(400).json({ error: 'File wajib diunggah.' });
            const o = await loadOrg(req.legalOrgId);
            const docs = { ...(o.legalDocs || {}) };
            const prev = docs[req.params.doc];
            docs[req.params.doc] = { url: path.relative(ROOT, req.file.path), originalName: req.file.originalname.slice(0, 200), uploadedAt: new Date().toISOString() };
            await db.update(organizations).set({ legalDocs: docs, updatedAt: new Date() }).where(eq(organizations.id, o.id));
            // Remove the replaced file (best effort).
            if (prev?.url) fs.unlink(path.join(ROOT, prev.url), () => {});
            await accessService.refreshLegalStatus(o.id);
            res.json(view(await loadOrg(o.id)));
        } catch (e) { next(e); }
    });
});

// Stream a document — members of the same agency only (route is org-bound).
router.get('/file/:doc', requirePerm('settings', 'view'), auditRead('view', 'legal_document'), async (req, res, next) => {
    try {
        if (!LEGAL_DOCS.includes(req.params.doc)) return res.status(400).json({ error: 'Jenis dokumen tidak dikenal.' });
        const o = await loadOrg(req.legalOrgId);
        const rel = o?.legalDocs?.[req.params.doc]?.url;
        if (!rel) return res.status(404).json({ error: 'Dokumen belum diunggah.' });
        const abs = path.resolve(ROOT, rel);
        if (!abs.startsWith(path.resolve(ROOT, String(o.id)) + path.sep)) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
        return sendFileDecrypted(res, abs);
    } catch (e) { next(e); }
});

export default router;
