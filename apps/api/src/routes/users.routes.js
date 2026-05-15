import { Router } from 'express';
import { db } from '../db/index.js';
import { user, organizations, account } from '../db/schema.js';
import { eq, ilike, or, asc, desc, sql, and } from 'drizzle-orm';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import { requireActiveUser } from '../middleware/scope.js';
import { hashPassword } from '@better-auth/utils/password';
import { randomUUID } from 'crypto';

const router = Router();

// ─── All user-management routes require login + active account ────────
router.use(requireAuth, requireActiveUser);

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
router.get('/', requireAdmin, async (req, res, next) => {
    try {
        const { search, role, organizationId, page = 1, limit = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const conditions = [];

        // Role-based visibility
        if (req.user.role === 'admin') {
            // Company admin: only sees users in their own org
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
            createdAt: user.createdAt,
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
        const data = rows.map(u => ({
            ...u,
            organizationName: u.organizationId ? (orgMap[u.organizationId] || null) : null,
        }));

        res.json({ data, total: Number(count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) { next(error); }
});

/**
 * POST /api/users  — create user (superadmin can set any role/org; admin limited to own org)
 */
router.post('/', requireAdmin, async (req, res, next) => {
    try {
        const { name, email, password, role, organizationId } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Nama, email, dan password wajib diisi.' });
        }

        // Admin can only create users within their own org and below their role
        let targetOrgId = organizationId ? parseInt(organizationId) : null;
        if (req.user.role === 'admin') {
            targetOrgId = req.user.organizationId || null;
            if (role === 'superadmin') {
                return res.status(403).json({ error: 'Admin tidak dapat membuat akun superadmin.' });
            }
        }

        // Hash password and create user directly in DB (Better Auth compatible format)
        const hashed = await hashPassword(password);
        const userId = randomUUID();
        const now = new Date();

        await db.insert(user).values({
            id: userId,
            name,
            email,
            emailVerified: false,
            role: role || 'agent',
            organizationId: targetOrgId,
            isActive: true,
            isDemo: role === 'demo',
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

        const [updated] = await db.select({
            id: user.id, name: user.name, email: user.email, role: user.role,
            organizationId: user.organizationId, isActive: user.isActive, isDemo: user.isDemo,
        }).from(user).where(eq(user.id, userId));

        res.status(201).json(updated);
    } catch (error) {
        const msg = error?.message || '';
        if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('duplicate')) {
            return res.status(409).json({ error: 'Email sudah terdaftar.' });
        }
        next(error);
    }
});

/**
 * PUT /api/users/:id  — update role, org, active status
 * Superadmin can change anything. Admin can only manage users in their own org.
 */
router.put('/:id', requireAdmin, async (req, res, next) => {
    try {
        const targetId = req.params.id;

        // Fetch target user first
        const [target] = await db.select().from(user).where(eq(user.id, targetId));
        if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

        // Enforce org boundary for admin
        if (req.user.role === 'admin') {
            if (target.organizationId !== req.user.organizationId) {
                return res.status(403).json({ error: 'Akses ditolak.' });
            }
            if (req.body.role === 'superadmin') {
                return res.status(403).json({ error: 'Admin tidak dapat mengubah role ke superadmin.' });
            }
        }

        // Prevent self-demotion
        if (targetId === req.user.id && req.body.isActive === false) {
            return res.status(400).json({ error: 'Tidak dapat menonaktifkan akun sendiri.' });
        }

        const patch = { updatedAt: new Date() };
        if (req.body.name !== undefined) patch.name = req.body.name;
        if (req.body.role !== undefined) patch.role = req.body.role;
        if (req.body.organizationId !== undefined) patch.organizationId = req.body.organizationId ? parseInt(req.body.organizationId) : null;
        if (req.body.isActive !== undefined) patch.isActive = req.body.isActive;
        if (req.body.isDemo !== undefined) patch.isDemo = req.body.isDemo;
        // Auto-set isDemo when role changes to demo
        if (patch.role === 'demo') patch.isDemo = true;
        if (patch.role && patch.role !== 'demo') patch.isDemo = false;

        const [updated] = await db.update(user).set(patch).where(eq(user.id, targetId)).returning({
            id: user.id, name: user.name, email: user.email, role: user.role,
            organizationId: user.organizationId, isActive: user.isActive, isDemo: user.isDemo,
        });

        res.json(updated);
    } catch (error) { next(error); }
});

/**
 * POST /api/users/:id/reset-password — superadmin only
 */
router.post('/:id/reset-password', requireSuperAdmin, async (req, res, next) => {
    try {
        const { password } = req.body;
        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Password minimal 6 karakter.' });
        }
        const targetId = req.params.id;
        const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, targetId));
        if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

        const hashed = await hashPassword(password);
        const now = new Date();

        // Update existing credential record, or insert if none exists
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

/**
 * DELETE /api/users/:id — superadmin only, cannot delete self
 */
router.delete('/:id', requireSuperAdmin, async (req, res, next) => {
    try {
        const targetId = req.params.id;
        if (targetId === req.user.id) {
            return res.status(400).json({ error: 'Tidak dapat menghapus akun sendiri.' });
        }
        // Cascade sessions / accounts handled by DB FK
        const rows = await db.delete(user).where(eq(user.id, targetId)).returning({ id: user.id, name: user.name });
        if (!rows[0]) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        res.json({ message: `Akun ${rows[0].name} dihapus.` });
    } catch (error) { next(error); }
});

export default router;
