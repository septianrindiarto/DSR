import { Router } from 'express';
import { db } from '../db/index.js';
import { user, organizations, account } from '../db/schema.js';
import { eq, ilike, or, asc, desc, sql, and } from 'drizzle-orm';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import { requireActiveUser } from '../middleware/scope.js';
import { hashPassword } from '@better-auth/utils/password';
import { randomUUID } from 'crypto';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';
import { accessService, getAccess, invalidateUser } from '../services/access.service.js';
import { auditRead } from '../middleware/logger.js';
import { SYSTEM_TEMPLATES, accountTypeOf, canAssign, defaultTemplateKey } from '../services/access-core.js';
import { auth } from '../auth.js';

// Sends Better Auth's verification email (our hook in auth.js builds the
// /verify-email link). Never throws: account creation must not fail on SMTP.
async function sendVerification(email) {
    try { await auth.api.sendVerificationEmail({ body: { email } }); return true; }
    catch (err) { console.error('[users] verification email failed:', err?.message); return false; }
}

const router = Router();

// ─── All user-management routes require login + active account ────────
router.use(requireAuth, requireActiveUser);

// ─────────────────────────────────────────────────────────────────────
// SELF — the caller can view + edit their own profile
// ─────────────────────────────────────────────────────────────────────

// GET /api/users/me/export — UU PDP "hak akses data": everything the platform
// holds about the caller as one JSON download (profile, customer records,
// their orders, recent own activity). Registered before /me/* handlers.
router.get('/me/export', auditRead('export', 'own_data'), async (req, res, next) => {
    try {
        const { customers, orders, activityLogs } = await import('../db/schema.js');
        const [u] = await db.select({
            id: user.id, name: user.name, email: user.email, role: user.role, accountType: user.accountType,
            organizationId: user.organizationId, createdAt: user.createdAt, twoFactorEnabled: user.twoFactorEnabled,
        }).from(user).where(eq(user.id, req.user.id)).limit(1);
        const custs = await db.select().from(customers).where(eq(customers.userId, req.user.id));
        const custIds = custs.map((c) => c.id);
        const ords = custIds.length ? await db.select({
            orderNumber: orders.orderNumber, status: orders.status, pickupDate: orders.pickupDate, returnDate: orders.returnDate,
            destination: orders.destination, pickupLocation: orders.pickupLocation, totalPrice: orders.totalPrice, createdAt: orders.createdAt,
        }).from(orders).where(sql`${orders.customerId} IN (${sql.join(custIds, sql`, `)})`).orderBy(desc(orders.createdAt)) : [];
        const acts = await db.select({ action: activityLogs.action, entity: activityLogs.entity, createdAt: activityLogs.createdAt, ipAddress: activityLogs.ipAddress })
            .from(activityLogs).where(eq(activityLogs.userId, req.user.id)).orderBy(desc(activityLogs.createdAt)).limit(500);
        res.setHeader('Content-Disposition', `attachment; filename=data-saya-${new Date().toISOString().slice(0, 10)}.json`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({ exportedAt: new Date().toISOString(), profile: u, customers: custs, orders: ords, activity: acts });
    } catch (e) { next(e); }
});

// GET /api/users/me — the caller's own row + the linked customer (if any)
router.get('/me', async (req, res, next) => {
    try {
        const { customers } = await import('../db/schema.js');
        const [u] = await db.select({
            id: user.id, name: user.name, email: user.email,
            role: user.role, accountType: user.accountType,
            organizationId: user.organizationId,
            emailVerified: user.emailVerified,
            createdAt: user.createdAt,
        }).from(user).where(eq(user.id, req.user.id)).limit(1);
        if (!u) return res.status(404).json({ error: 'User tidak ditemukan' });

        // Pull phone + companyName + customerType from the linked customer.
        const [cust] = await db.select({
            id: customers.id, phone: customers.phone, whatsapp: customers.whatsapp,
            companyName: customers.companyName, customerType: customers.customerType,
        }).from(customers).where(eq(customers.userId, req.user.id)).limit(1);

        // Org name (read-only) for client members.
        let organizationName = null;
        if (u.organizationId) {
            const [org] = await db.select({ name: organizations.name })
                .from(organizations).where(eq(organizations.id, u.organizationId)).limit(1);
            organizationName = org?.name || null;
        }

        res.json({ ...u, customer: cust || null, organizationName });
    } catch (err) { next(err); }
});

// PUT /api/users/me — update the caller's editable fields. Email changes are
// rejected here because they require re-verification; that's a separate flow.
router.put('/me', async (req, res, next) => {
    try {
        const { customers } = await import('../db/schema.js');
        const { name, phone, email: emailIgnored } = req.body || {};
        if (emailIgnored && emailIgnored !== req.user.email) {
            return res.status(400).json({
                error: 'Mengubah email memerlukan verifikasi ulang. Hubungi admin atau gunakan halaman reset email.',
            });
        }

        // Update user.name if provided.
        if (typeof name === 'string' && name.trim().length > 0) {
            await db.update(user)
                .set({ name: name.trim(), updatedAt: new Date() })
                .where(eq(user.id, req.user.id));
        }

        // Update phone on the linked customer row (creating one if missing —
        // older accounts may not have a customer row).
        if (typeof phone === 'string' && phone.trim().length > 0) {
            const [existing] = await db.select({ id: customers.id })
                .from(customers).where(eq(customers.userId, req.user.id)).limit(1);
            if (existing) {
                await db.update(customers)
                    .set({ phone: phone.trim(), whatsapp: phone.trim() })
                    .where(eq(customers.id, existing.id));
            } else {
                await db.insert(customers).values({
                    userId: req.user.id,
                    name: name || req.user.name,
                    email: req.user.email,
                    phone: phone.trim(),
                    whatsapp: phone.trim(),
                    customerType: 'private',
                });
            }
        }

        res.json({ ok: true, message: 'Profil tersimpan.' });
    } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────
// ACCESS (RBAC v2) — literal paths, registered before /:id
// ─────────────────────────────────────────────────────────────────────
const sendErr = (res, next) => (e) => (e.status ? res.status(e.status).json({ error: e.message }) : next(e));

// The caller's own effective permissions (used by the frontend to show
// exactly what the server allows) + org legal status for agencies.
router.get('/me/access', async (req, res, next) => {
    try {
        const a = await getAccess(req.user.id);
        res.json({
            permissions: [...a.perms].sort(), templateKey: a.templateKey, templateName: a.templateName,
            accountType: a.accountType, role: a.role, organizationId: a.organizationId, legalStatus: a.legalStatus,
        });
    } catch (e) { next(e); }
});

router.get('/access/templates', requireAnyPerm('users.view', 'users.edit', 'settings.edit'), async (req, res, next) => {
    try { res.json(await accessService.listTemplates(req.user.id, { orgId: req.query.orgId })); } catch (e) { sendErr(res, next)(e); }
});
router.post('/access/templates', requirePerm('users', 'edit'), async (req, res, next) => {
    try { res.json(await accessService.saveTemplate(req.user.id, req.body || {})); } catch (e) { sendErr(res, next)(e); }
});
router.post('/access/templates/fork', requirePerm('users', 'edit'), async (req, res, next) => {
    try { res.json(await accessService.forkTemplate(req.user.id, req.body || {})); } catch (e) { sendErr(res, next)(e); }
});
router.put('/access/templates/:tid', requirePerm('users', 'edit'), async (req, res, next) => {
    try { res.json(await accessService.saveTemplate(req.user.id, { ...(req.body || {}), id: req.params.tid })); } catch (e) { sendErr(res, next)(e); }
});
router.delete('/access/templates/:tid', requirePerm('users', 'edit'), async (req, res, next) => {
    try { res.json(await accessService.deleteTemplate(req.user.id, req.params.tid)); } catch (e) { sendErr(res, next)(e); }
});
router.put('/access/default-template', requirePerm('users', 'edit'), async (req, res, next) => {
    try { res.json(await accessService.setDefaultTemplate(req.user.id, req.body?.templateKey || null)); } catch (e) { sendErr(res, next)(e); }
});
router.get('/access/audit', requirePerm('users', 'view'), async (req, res, next) => {
    try { res.json(await accessService.auditLog(req.user.id, req.query)); } catch (e) { sendErr(res, next)(e); }
});

// ─────────────────────────────────────────────────────────────────────
// ORGANIZATIONS CRUD (superadmin only)
// ─────────────────────────────────────────────────────────────────────

router.get('/orgs', requireSuperAdmin, async (req, res, next) => {
    try {
        const rows = await db.select().from(organizations).orderBy(asc(organizations.name));
        res.json(rows);
    } catch (error) { next(error); }
});

router.post('/orgs', requireSuperAdmin, async (req, res, next) => {
    try {
        const { name, slug } = req.body;
        if (!name) return res.status(400).json({ error: 'Nama organisasi wajib diisi.' });
        const rows = await db.insert(organizations).values({
            name,
            slug: slug || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
            isActive: true,
        }).returning();
        res.status(201).json(rows[0]);
    } catch (error) { next(error); }
});

router.put('/orgs/:id', requireSuperAdmin, async (req, res, next) => {
    try {
        const { name, slug, isActive } = req.body;
        const patch = { updatedAt: new Date() };
        if (name !== undefined) patch.name = name;
        if (slug !== undefined) patch.slug = slug;
        if (isActive !== undefined) patch.isActive = isActive;
        const rows = await db.update(organizations).set(patch).where(eq(organizations.id, parseInt(req.params.id))).returning();
        if (!rows[0]) return res.status(404).json({ error: 'Organisasi tidak ditemukan.' });
        res.json(rows[0]);
    } catch (error) { next(error); }
});

router.delete('/orgs/:id', requireSuperAdmin, async (req, res, next) => {
    try {
        const rows = await db.delete(organizations).where(eq(organizations.id, parseInt(req.params.id))).returning();
        if (!rows[0]) return res.status(404).json({ error: 'Organisasi tidak ditemukan.' });
        res.json({ message: 'Organisasi dihapus.', data: rows[0] });
    } catch (error) { next(error); }
});

// ─────────────────────────────────────────────────────────────────────
// USERS LIST + MANAGE
// ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/users
 * superadmin → all users
 * admin      → only users in their own organization
 */
router.get('/', requirePerm('users', 'view'), async (req, res, next) => {
    try {
        const { search, role, organizationId, page = 1, limit = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const conditions = [];

        // Role-based visibility
        if (req.user.role !== 'superadmin') {
            // Anyone but superadmin: only users in their own org
            if (!req.user.organizationId) return res.json({ data: [], total: 0, page: 1, limit: 50 });
            conditions.push(eq(user.organizationId, req.user.organizationId));
        }

        if (search) {
            conditions.push(or(
                ilike(user.name, `%${search}%`),
                ilike(user.email, `%${search}%`)
            ));
        }
        if (role) conditions.push(eq(user.role, role));
        if (organizationId && req.user.role === 'superadmin') {
            conditions.push(eq(user.organizationId, parseInt(organizationId)));
        }

        let query = db.select({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            organizationId: user.organizationId,
            isActive: user.isActive,
            isDemo: user.isDemo,
            emailVerified: user.emailVerified,
            createdAt: user.createdAt,
            accountType: user.accountType,
            templateKey: user.templateKey,
            permGrants: user.permGrants,
            permRevokes: user.permRevokes,
        }).from(user);

        let countQuery = db.select({ count: sql`count(*)` }).from(user);

        if (conditions.length > 0) {
            query = query.where(and(...conditions));
            countQuery = countQuery.where(and(...conditions));
        }

        const rows = await query.orderBy(desc(user.createdAt)).limit(parseInt(limit)).offset(offset);
        const [{ count }] = await countQuery;

        // Attach organization names
        const orgs = await db.select().from(organizations);
        const orgMap = Object.fromEntries(orgs.map(o => [o.id, o.name]));
        const orgType = Object.fromEntries(orgs.map(o => [o.id, o.parentAgencyId == null ? 'agency' : 'client']));
        const data = rows.map(({ permGrants, permRevokes, ...u }) => ({
            ...u,
            // account type follows the organisation (stored value can be stale)
            accountType: u.role !== 'superadmin' && orgType[u.organizationId] ? orgType[u.organizationId] : accountTypeOf(u),
            // role (template) actually in force; NULL = derived default
            templateKey: u.role === 'superadmin' ? null : (u.templateKey || defaultTemplateKey(u)),
            customized: (Array.isArray(permGrants) && permGrants.length > 0) || (Array.isArray(permRevokes) && permRevokes.length > 0),
            organizationName: u.organizationId ? (orgMap[u.organizationId] || null) : null,
        }));

        res.json({ data, total: Number(count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) { next(error); }
});

/**
 * POST /api/users  — create user (superadmin can set any role/org; admin limited to own org)
 */
router.post('/', requirePerm('users', 'create'), async (req, res, next) => {
    try {
        const { name, email, password, role, organizationId, templateKey, accountType } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Nama, email, dan password wajib diisi.' });
        }
        if (String(password).length < 8) return res.status(400).json({ error: 'Password minimal 8 karakter.' });

        // Non-superadmins create users ONLY in their own org, with their own
        // account type (was: account_type defaulted to 'client' even when an
        // agency admin added staff), and never a superadmin.
        const isSuper = req.user.role === 'superadmin';
        let targetOrgId = isSuper ? (organizationId ? parseInt(organizationId) : null) : (req.user.organizationId || null);
        if (!isSuper && !targetOrgId) return res.status(400).json({ error: 'Akun Anda belum terhubung ke organisasi.' });
        // Exactly ONE superadmin exists in the whole platform; it can never be created through the API.
        if (role === 'superadmin') return res.status(403).json({ error: 'Superadmin hanya satu akun untuk seluruh aplikasi dan tidak dapat dibuat lagi.' });
        const actorAccess = await getAccess(req.user.id);
        let targetAccountType = isSuper ? (accountType === 'client' ? 'client' : accountType === 'agency' ? 'agency' : actorAccess.accountType) : actorAccess.accountType;
        if (isSuper && targetOrgId) {
            // A member's account type always follows their organisation.
            const [o] = await db.select({ parentAgencyId: organizations.parentAgencyId }).from(organizations).where(eq(organizations.id, targetOrgId)).limit(1);
            if (!o) return res.status(400).json({ error: 'Organisasi tidak ditemukan.' });
            targetAccountType = o.parentAgencyId == null ? 'agency' : 'client';
        }
        // No organisation = individual (private) client: books for themselves,
        // gets their own invoices. An agency account without an organisation
        // would see nothing (scope keys off the org), so it is never created.
        if (isSuper && !targetOrgId) targetAccountType = 'client';
        const tKey = templateKey || await accessService.templateForNewMember(targetOrgId, targetAccountType, false);
        const sys = SYSTEM_TEMPLATES[tKey];
        if (sys && sys.accountType !== targetAccountType) return res.status(400).json({ error: 'Template tidak sesuai tipe akun.' });
        const tList = await accessService.listTemplates(req.user.id);
        const tpl = tList.templates.find((t) => t.key === tKey);
        if (!tpl) return res.status(400).json({ error: 'Role tidak ditemukan.' });
        if (tpl.accountType !== targetAccountType || (!tpl.system && tpl.organizationId !== targetOrgId)) return res.status(400).json({ error: 'Role tidak sesuai dengan organisasi pengguna.' });
        const chk = canAssign({ actorRole: req.user.role, actorAccountType: actorAccess.accountType, actorPerms: actorAccess.perms, targetAccountType, targetPerms: new Set(tpl.permissions) });
        if (!chk.ok) return res.status(403).json({ error: chk.reason });
        const finalRole = role === 'demo' && isSuper ? 'demo' : (/admin$/.test(tKey) || tpl.permissions.includes('users.edit') ? 'admin' : 'user');

        const wantVerify = req.body.sendVerification === true;

        // Hash password and create user directly in DB (Better Auth compatible format)
        const hashed = await hashPassword(password);
        const userId = randomUUID();
        const now = new Date();

        await db.insert(user).values({
            id: userId,
            name,
            email,
            // sendVerification = true (default in the form): the user must
            // confirm the address from the email before signing in (proves the
            // mailbox is theirs). false = admin hands the account over and it
            // works immediately (e.g. a colleague sitting next to you).
            emailVerified: !wantVerify,
            role: finalRole,
            accountType: targetAccountType,
            templateKey: tKey,
            organizationId: targetOrgId,
            isActive: true,
            isDemo: finalRole === 'demo',
            createdAt: now,
            updatedAt: now,
        });

        // Insert credential record for Better Auth (email/password provider)
        await db.insert(account).values({
            id: randomUUID(),
            accountId: userId,
            providerId: 'credential',
            userId,
            password: hashed,
            createdAt: now,
            updatedAt: now,
        });

        // Individual client: link (or create) their customer record, the same
        // as self-registration does, so their bookings and invoices attach to them.
        if (targetAccountType === 'client' && !targetOrgId) {
            try {
                const { customers } = await import('../db/schema.js');
                const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.email, email)).limit(1);
                if (c) await db.update(customers).set({ userId, name }).where(eq(customers.id, c.id));
                else await db.insert(customers).values({ userId, name, email, customerType: 'private' });
            } catch (custErr) { console.error('[users] customer link failed:', custErr?.message); }
        }

        const verificationSent = wantVerify ? await sendVerification(email) : false;

        const [updated] = await db.select({
            id: user.id, name: user.name, email: user.email, role: user.role,
            organizationId: user.organizationId, isActive: user.isActive, isDemo: user.isDemo,
            emailVerified: user.emailVerified,
        }).from(user).where(eq(user.id, userId));

        res.status(201).json({ ...updated, verificationSent });
    } catch (error) {
        // Postgres unique_violation is code 23505. With Drizzle + postgres-js
        // the original driver error (with the code) is on error.cause, while
        // error.message is just "Failed query: …", so we must inspect both the
        // code and the combined message text.
        const code = error?.code || error?.cause?.code;
        const msg = `${error?.message || ''} ${error?.cause?.message || ''}`.toLowerCase();
        if (code === '23505' || msg.includes('already exists') || msg.includes('duplicate') || msg.includes('unique constraint')) {
            return res.status(409).json({ error: 'Email sudah terdaftar.' });
        }
        next(error);
    }
});

/**
 * PUT /api/users/:id  — update role, org, active status
 * Superadmin can change anything. Admin can only manage users in their own org.
 */
router.put('/:id', requirePerm('users', 'edit'), async (req, res, next) => {
    try {
        const targetId = req.params.id;

        // Fetch target user first
        const [target] = await db.select().from(user).where(eq(user.id, targetId));
        if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

        // Org boundary for everyone except superadmin (was: only role 'admin').
        const isSuper = req.user.role === 'superadmin';
        if (!isSuper) {
            if (!req.user.organizationId || target.organizationId !== req.user.organizationId) {
                return res.status(403).json({ error: 'Akses ditolak.' });
            }
            if (target.role === 'superadmin') return res.status(403).json({ error: 'Akun superadmin tidak dapat diubah.' });
        }

        // Prevent self-demotion
        if (targetId === req.user.id && req.body.isActive === false) {
            return res.status(400).json({ error: 'Tidak dapat menonaktifkan akun sendiri.' });
        }

        // Role / permissions are changed through PUT /:id/access (template +
        // escalation check). Moving a user to another org or changing role,
        // demo flag or account type directly is superadmin-only.
        const patch = { updatedAt: new Date() };
        if (req.body.name !== undefined) patch.name = req.body.name;
        if (req.body.isActive !== undefined) patch.isActive = !!req.body.isActive;
        if (isSuper) {
            // The level (superadmin/admin/user) follows the role (template) — never set directly.
            // Exactly one superadmin: nobody can be promoted to it, and it can't be demoted.
            if (req.body.role === 'superadmin' && target.role !== 'superadmin') {
                return res.status(403).json({ error: 'Superadmin hanya satu akun untuk seluruh aplikasi.' });
            }
            if (target.role === 'superadmin' && req.body.role && req.body.role !== 'superadmin') {
                return res.status(400).json({ error: 'Akun superadmin tidak dapat diturunkan.' });
            }
            if (target.role === 'superadmin' && req.body.isActive === false) {
                return res.status(400).json({ error: 'Akun superadmin tidak dapat dinonaktifkan.' });
            }
            if (target.role !== 'superadmin' && req.body.demo !== undefined) {
                if (req.body.demo) patch.role = 'demo';
                else if (target.role === 'demo') {
                    const key = target.templateKey || defaultTemplateKey(target);
                    patch.role = /admin$/.test(key) ? 'admin' : 'user';
                }
            }
            if (req.body.organizationId !== undefined) patch.organizationId = req.body.organizationId ? parseInt(req.body.organizationId) : null;
            if (req.body.isDemo !== undefined) patch.isDemo = req.body.isDemo;
            if (req.body.accountType === 'agency' || req.body.accountType === 'client') patch.accountType = req.body.accountType;
            if (patch.role === 'demo') patch.isDemo = true;
            if (patch.role && patch.role !== 'demo') patch.isDemo = false;
        } else if (req.body.role !== undefined || req.body.organizationId !== undefined) {
            return res.status(403).json({ error: 'Ubah role lewat menu Hak Akses; memindah organisasi hanya untuk superadmin.' });
        }

        // Superadmin moves a user to another organisation (e.g. reusing a test
        // account after its organisation was removed): the account type follows
        // the new organisation, and the role is reset to one valid there
        // (the chosen one, else the organisation's default for new members).
        if (isSuper && target.role !== 'superadmin' && patch.role !== 'superadmin' && (req.body.organizationId !== undefined || req.body.templateKey)) {
            const newOrgId = patch.organizationId !== undefined ? patch.organizationId : target.organizationId;
            // No organisation = individual client (an org-less agency account sees nothing).
            let newType = 'client';
            if (newOrgId) {
                const [o] = await db.select({ parentAgencyId: organizations.parentAgencyId }).from(organizations).where(eq(organizations.id, newOrgId)).limit(1);
                if (!o) return res.status(400).json({ error: 'Organisasi tidak ditemukan.' });
                newType = o.parentAgencyId == null ? 'agency' : 'client';
            }
            const orgChanged = (newOrgId || null) !== (target.organizationId || null);
            const tList = await accessService.listTemplates(req.user.id);
            const fits = (key) => {
                const t = tList.templates.find((x) => x.key === key);
                return t && t.accountType === newType && (t.system || t.organizationId === newOrgId) ? t : null;
            };
            let tpl = req.body.templateKey ? fits(req.body.templateKey) : null;
            if (req.body.templateKey && !tpl) return res.status(400).json({ error: 'Role tidak sesuai dengan organisasi pengguna.' });
            if (!tpl && (orgChanged || !fits(target.templateKey || defaultTemplateKey(target)))) {
                tpl = fits(await accessService.templateForNewMember(newOrgId, newType, false));
            }
            patch.accountType = newType;
            if (tpl) {
                patch.templateKey = tpl.key;
                patch.permGrants = []; patch.permRevokes = [];
                if (target.role !== 'demo') patch.role = /admin$/.test(tpl.key) || tpl.permissions.includes('users.edit') ? 'admin' : 'user';
            }
        }

        if (patch.isActive === false) {
            try { const { session } = await import('../db/schema.js'); await db.delete(session).where(eq(session.userId, targetId)); } catch { /* best effort */ }
        }
        invalidateUser(targetId);
        const [updated] = await db.update(user).set(patch).where(eq(user.id, targetId)).returning({
            id: user.id, name: user.name, email: user.email, role: user.role,
            organizationId: user.organizationId, isActive: user.isActive, isDemo: user.isDemo,
        });

        res.json(updated);
    } catch (error) { next(error); }
});

// POST /api/users/:id/resend-verification — resend the confirmation email to
// an account that hasn't verified yet (same org boundary as editing).
router.post('/:id/resend-verification', requirePerm('users', 'edit'), async (req, res, next) => {
    try {
        const [target] = await db.select({ email: user.email, emailVerified: user.emailVerified, organizationId: user.organizationId, role: user.role })
            .from(user).where(eq(user.id, req.params.id)).limit(1);
        if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        if (req.user.role !== 'superadmin' && (!req.user.organizationId || target.organizationId !== req.user.organizationId)) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        }
        if (target.emailVerified) return res.status(409).json({ error: 'Email pengguna ini sudah terverifikasi.' });
        const ok = await sendVerification(target.email);
        if (!ok) return res.status(502).json({ error: 'Email verifikasi gagal dikirim. Coba lagi nanti.' });
        res.json({ ok: true });
    } catch (e) { next(e); }
});

router.get('/:id/access', requirePerm('users', 'view'), async (req, res, next) => {
    try { res.json(await accessService.getUserAccess(req.user.id, req.params.id)); } catch (e) { sendErr(res, next)(e); }
});
router.put('/:id/access', requirePerm('users', 'edit'), async (req, res, next) => {
    try {
        const { templateKey, permissions } = req.body || {};
        res.json(await accessService.setUserAccess(req.user.id, req.params.id, { templateKey, permissions }));
    } catch (e) { sendErr(res, next)(e); }
});

router.post('/:id/reset-password', requireSuperAdmin, async (req, res, next) => {
    try {
        const { password } = req.body;
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password minimal 8 karakter.' });
        }
        const targetId = req.params.id;
        const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, targetId));
        if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

        const hashed = await hashPassword(password);
        const now = new Date();
        const existing = await db.select({ id: account.id }).from(account)
            .where(and(eq(account.userId, targetId), eq(account.providerId, 'credential')));
        if (existing.length > 0) {
            await db.update(account).set({ password: hashed, updatedAt: now })
                .where(and(eq(account.userId, targetId), eq(account.providerId, 'credential')));
        } else {
            await db.insert(account).values({
                id: randomUUID(),
                accountId: targetId,
                providerId: 'credential',
                userId: targetId,
                password: hashed,
                createdAt: now,
                updatedAt: now,
            });
        }
        res.json({ message: 'Password berhasil direset.' });
    } catch (error) { next(error); }
});

// DELETE /api/users/:id - soft-deactivate a user.
//
// Task 50: admin-only action in Manajemen Pengguna. Previously gated to
// requireSuperAdmin; relaxed so an organization admin can deactivate users
// inside their own org. Hard-deletion is avoided because user.id is
// referenced by many tables (orders.created_by, orders.approved_by,
// customers.user_id, etc.) with mixed cascade rules. Soft-deactivation:
//   - sets isActive=false (already gated by requireActiveUser middleware,
//     so the deactivated user is locked out of every API call)
//   - deletes any active session rows for the user so they are immediately
//     logged out across devices
//   - returns 200 with a friendly message
//
// Guards:
//   - self-delete blocked
//   - non-superadmin callers may only delete users in their OWN org
//   - non-superadmin callers may not delete a superadmin
//   - 404 if the target id is unknown
router.delete('/:id', requirePerm('users', 'delete'), async (req, res, next) => {
    try {
        const targetId = req.params.id;
        if (targetId === req.user.id) {
            return res.status(400).json({ error: 'Tidak dapat menghapus akun sendiri.' });
        }

        const [target] = await db.select({
            id: user.id, name: user.name, role: user.role,
            organizationId: user.organizationId, isActive: user.isActive,
        }).from(user).where(eq(user.id, targetId));
        if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

        if (req.user.role !== 'superadmin') {
            if (!req.user.organizationId || target.organizationId !== req.user.organizationId) {
                return res.status(403).json({ error: 'Akses ditolak. Hanya admin di organisasi yang sama yang dapat menghapus akun ini.' });
            }
            if (target.role === 'superadmin') {
                return res.status(403).json({ error: 'Admin tidak dapat menghapus akun superadmin.' });
            }
        }

        if (target.isActive === false) {
            return res.status(200).json({ message: `Akun ${target.name} sudah nonaktif.` });
        }

        await db.update(user)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(user.id, targetId));
        invalidateUser(targetId);

        try {
            const { session } = await import('../db/schema.js');
            await db.delete(session).where(eq(session.userId, targetId));
        } catch (sessionErr) {
            console.warn('[users.delete] failed to clear sessions for', targetId, sessionErr?.message);
        }

        res.json({
            message: `Akun ${target.name} dinonaktifkan. Pengguna ini tidak dapat lagi login.`,
            id: target.id,
            isActive: false,
        });
    } catch (error) { next(error); }
});

export default router;
