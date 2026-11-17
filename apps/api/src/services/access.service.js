// ─── RBAC v2 service — effective permissions (cached), templates, audit ──────
// Performance: the effective permission set of a user is computed once and
// cached in memory for CACHE_MS (one indexed PK read of the user row + at most
// one template row + one org row on a miss). Every write that can change
// access invalidates the affected users/orgs immediately, so changes apply on
// the user's next request without waiting for the TTL.
// Single PM2 instance → in-process cache is correct; with several instances
// the TTL bounds staleness to CACHE_MS.
import { db } from '../db/index.js';
import { user as userTable, organizations, permissionTemplates, permissionAudit } from '../db/schema.js';
import { and, eq, desc, inArray } from 'drizzle-orm';
import {
    SYSTEM_TEMPLATES, ALL_PERMS, CLIENT_ALLOWED, effectivePermissions, defaultTemplateKey,
    accountTypeOf, canAssign, diffFromTemplate, legalComplete,
} from './access-core.js';

const CACHE_MS = 30_000;
const cache = new Map();          // userId → { at, data }
const templateCache = new Map();  // 'org:<id>' → { at, perms, accountType, organizationId }
const orgCache = new Map();       // orgId → { at, legalStatus }

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const fresh = (entry) => entry && Date.now() - entry.at < CACHE_MS;

export function invalidateUser(userId) { cache.delete(userId); }
export function invalidateOrg(orgId) {
    orgCache.delete(Number(orgId));
    for (const [k, v] of cache) if (v.data.organizationId === Number(orgId)) cache.delete(k);
}
function invalidateTemplate(key) {
    templateCache.delete(key);
    for (const [k, v] of cache) if (v.data.templateKey === key) cache.delete(k);
}

async function templateInfo(key) {
    if (SYSTEM_TEMPLATES[key]) return { ...SYSTEM_TEMPLATES[key], key, system: true };
    const m = /^org:(\d+)$/.exec(key || '');
    if (!m) return null;
    const hit = templateCache.get(key);
    if (fresh(hit)) return hit.data;
    const [t] = await db.select().from(permissionTemplates).where(eq(permissionTemplates.id, Number(m[1]))).limit(1);
    const data = t ? { key, name: t.name, accountType: t.accountType, permissions: t.permissions || [], organizationId: t.organizationId, system: false } : null;
    templateCache.set(key, { at: Date.now(), data });
    return data;
}

async function orgLegalStatus(orgId) {
    if (!orgId) return 'active';
    const hit = orgCache.get(Number(orgId));
    if (fresh(hit)) return hit.legalStatus;
    const [o] = await db.select({ legalStatus: organizations.legalStatus }).from(organizations).where(eq(organizations.id, Number(orgId))).limit(1);
    const legalStatus = o?.legalStatus || 'active';
    orgCache.set(Number(orgId), { at: Date.now(), legalStatus });
    return legalStatus;
}

/** Resolve the template a user actually uses (falls back if missing / foreign). */
async function resolveTemplate(u) {
    let key = u.templateKey || defaultTemplateKey(u);
    let t = await templateInfo(key);
    // An org template must belong to the user's org and account type.
    if (!t || (!t.system && (t.organizationId !== u.organizationId || t.accountType !== accountTypeOf(u)))) {
        key = defaultTemplateKey(u); t = await templateInfo(key);
    }
    return { key, template: t };
}

/**
 * Effective access for a user id. Returns
 *   { userId, role, accountType, organizationId, templateKey, templateName,
 *     perms:Set, legalStatus, isActive }
 */
// An account's type ALWAYS follows its organisation (agency org = no parent
// agency). The stored user.account_type can be stale (e.g. an organisation
// was changed from agency to client after its users joined); trusting it gave
// a client admin agency visibility and the "akun Agency" login error.
const orgTypeCache = new Map();   // orgId → { at, type }
export async function orgAccountType(orgId) {
    if (!orgId) return null;
    const hit = orgTypeCache.get(orgId);
    if (hit && Date.now() - hit.at < 60_000) return hit.type;
    const [o] = await db.select({ parent: organizations.parentAgencyId }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const type = o ? (o.parent == null ? 'agency' : 'client') : null;
    orgTypeCache.set(orgId, { at: Date.now(), type });
    return type;
}
export function forgetOrgType(orgId) { if (orgId) orgTypeCache.delete(Number(orgId)); else orgTypeCache.clear(); }
/** Effective account type of a user row / session user. */
export async function effectiveAccountType(u) {
    if (!u || u.role === 'superadmin') return accountTypeOf(u);
    return (await orgAccountType(u.organizationId)) || accountTypeOf(u);
}

export async function getAccess(userId) {
    const hit = cache.get(userId);
    if (fresh(hit)) return hit.data;
    const [u] = await db.select({
        id: userTable.id, role: userTable.role, accountType: userTable.accountType, organizationId: userTable.organizationId,
        isActive: userTable.isActive, templateKey: userTable.templateKey, permGrants: userTable.permGrants,
        permRevokes: userTable.permRevokes, permissions: userTable.permissions,
    }).from(userTable).where(eq(userTable.id, userId)).limit(1);
    if (!u) return null;
    const { key, template } = await resolveTemplate(u);
    const accountType = await effectiveAccountType(u);
    const legalStatus = accountType === 'agency' ? await orgLegalStatus(u.organizationId) : 'active';
    const data = {
        userId: u.id, role: u.role, accountType, organizationId: u.organizationId, isActive: u.isActive !== false,
        templateKey: key, templateName: template?.name || key, legalStatus,
        perms: effectivePermissions(u, template?.permissions || [], legalStatus),
        grants: Array.isArray(u.permGrants) ? u.permGrants : [], revokes: Array.isArray(u.permRevokes) ? u.permRevokes : [],
    };
    cache.set(userId, { at: Date.now(), data });
    return data;
}

export function hasPerm(access, perm) {
    return !!access && (access.role === 'superadmin' || access.perms.has(perm));
}

async function audit(entry) {
    try { await db.insert(permissionAudit).values(entry); } catch (e) { console.error('[access] audit failed:', e.message); }
}

/** Org the actor manages + guard that target belongs to it (superadmin: any). */
function assertSameOrg(actor, targetOrgId) {
    if (actor.role === 'superadmin') return;
    if (!actor.organizationId || actor.organizationId !== targetOrgId) throw httpError(403, 'Pengguna di luar organisasi Anda.');
}

export const accessService = {
    getAccess, hasPerm, invalidateUser, invalidateOrg,

    /**
     * Catalog + roles (templates) visible to the actor, with how many users use
     * each. Superadmin sees every organisation's roles (or one: opts.orgId).
     */
    async listTemplates(actorId, { orgId = null } = {}) {
        const actor = await getAccess(actorId);
        const isSuper = actor.role === 'superadmin';
        const scopeOrg = isSuper ? (Number(orgId) || null) : actor.organizationId;
        const sys = Object.entries(SYSTEM_TEMPLATES)
            .filter(([, t]) => isSuper || t.accountType === actor.accountType)
            .map(([key, t]) => ({ key, name: t.name, accountType: t.accountType, permissions: t.permissions, system: true }));
        let orgT = [];
        if (isSuper || actor.organizationId) {
            const q = db.select({ t: permissionTemplates, orgName: organizations.name }).from(permissionTemplates)
                .leftJoin(organizations, eq(organizations.id, permissionTemplates.organizationId));
            const rows = scopeOrg ? await q.where(eq(permissionTemplates.organizationId, scopeOrg)) : (isSuper ? await q : []);
            orgT = rows.map(({ t, orgName }) => ({ key: `org:${t.id}`, id: t.id, name: t.name, accountType: t.accountType, permissions: t.permissions || [], system: false, organizationId: t.organizationId, organizationName: orgName }));
        }
        // users per role (within the actor's scope)
        const uq = db.select({ id: userTable.id, role: userTable.role, accountType: userTable.accountType, templateKey: userTable.templateKey, organizationId: userTable.organizationId }).from(userTable);
        const members = scopeOrg ? await uq.where(eq(userTable.organizationId, scopeOrg)) : (isSuper ? await uq : []);
        const counts = {};
        for (const m of members) {
            if (m.role === 'superadmin') continue;
            const k = m.templateKey || defaultTemplateKey(m);
            counts[k] = (counts[k] || 0) + 1;
        }
        const [org] = actor.organizationId
            ? await db.select({ defaultTemplate: organizations.defaultTemplate }).from(organizations).where(eq(organizations.id, actor.organizationId)).limit(1)
            : [];
        return {
            templates: [...sys, ...orgT].map((t) => ({ ...t, userCount: counts[t.key] || 0 })),
            defaultTemplate: org?.defaultTemplate || null, allPerms: ALL_PERMS, clientAllowed: [...CLIENT_ALLOWED],
        };
    },

    /** Organisation a role is saved into (superadmin may pick any; others: own). */
    async _roleOrg(actor, organizationId) {
        const orgId = actor.role === 'superadmin' ? (Number(organizationId) || actor.organizationId) : actor.organizationId;
        if (!orgId) throw httpError(400, actor.role === 'superadmin' ? 'Pilih organisasi pemilik role.' : 'Akun tanpa organisasi tidak dapat membuat role.');
        const [o] = await db.select({ id: organizations.id, parentAgencyId: organizations.parentAgencyId }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
        if (!o) throw httpError(404, 'Organisasi tidak ditemukan.');
        return { orgId: o.id, accountType: o.parentAgencyId == null ? 'agency' : 'client' };
    },

    /**
     * "Edit" a built-in role for one organisation: save it as that org's own
     * role (same name by default) and move the org's users (and the default
     * for new members) from the built-in role to it.
     */
    async forkTemplate(actorId, { key, name, permissions, organizationId }) {
        const actor = await getAccess(actorId);
        const base = SYSTEM_TEMPLATES[key];
        if (!base) throw httpError(400, 'Hanya role bawaan yang dapat disalin dengan cara ini.');
        const { orgId, accountType } = await this._roleOrg(actor, organizationId);
        if (base.accountType !== accountType) throw httpError(400, 'Role ini tidak sesuai dengan tipe organisasi.');
        const saved = await this.saveTemplate(actorId, { name: name || base.name, accountType, permissions: permissions || base.permissions, organizationId: orgId });
        const newKey = `org:${saved.id}`;
        const members = await db.select({ id: userTable.id, role: userTable.role, accountType: userTable.accountType, templateKey: userTable.templateKey }).from(userTable).where(eq(userTable.organizationId, orgId));
        const move = members.filter((m) => m.role !== 'superadmin' && (m.templateKey || defaultTemplateKey(m)) === key).map((m) => m.id);
        if (move.length) {
            await db.update(userTable).set({ templateKey: newKey, updatedAt: new Date() }).where(inArray(userTable.id, move));
            move.forEach(invalidateUser);
        }
        await db.update(organizations).set({ defaultTemplate: newKey }).where(and(eq(organizations.id, orgId), eq(organizations.defaultTemplate, key)));
        await audit({ organizationId: orgId, actorId, targetTemplateId: saved.id, action: 'template.fork', before: { key }, after: { key: newKey, moved: move.length } });
        return { ...saved, moved: move.length };
    },

    async saveTemplate(actorId, { id, name, accountType, permissions, organizationId }) {
        const actor = await getAccess(actorId);
        const isSuper = actor.role === 'superadmin';
        let roleOrg;
        if (id) {
            const [cur0] = await db.select({ organizationId: permissionTemplates.organizationId, accountType: permissionTemplates.accountType }).from(permissionTemplates).where(eq(permissionTemplates.id, Number(id))).limit(1);
            if (!cur0 || (!isSuper && cur0.organizationId !== actor.organizationId)) throw httpError(404, 'Template tidak ditemukan.');
            roleOrg = { orgId: cur0.organizationId, accountType: cur0.accountType };
        } else {
            roleOrg = await this._roleOrg(actor, organizationId);
        }
        void accountType; // an org role always has the type of its organisation
        const at = roleOrg.accountType;
        const perms = new Set((permissions || []).filter((x) => ALL_PERMS.includes(x)));
        const chk = canAssign({ actorRole: actor.role, actorAccountType: actor.accountType, actorPerms: actor.perms, targetAccountType: at, targetPerms: perms });
        if (!chk.ok) throw httpError(403, chk.reason);
        const values = { name: String(name || '').trim().slice(0, 100) || 'Template', accountType: at, permissions: [...perms].sort(), updatedAt: new Date() };
        let row;
        if (id) {
            const [cur] = await db.select().from(permissionTemplates).where(and(eq(permissionTemplates.id, Number(id)), eq(permissionTemplates.organizationId, roleOrg.orgId))).limit(1);
            if (!cur) throw httpError(404, 'Template tidak ditemukan.');
            [row] = await db.update(permissionTemplates).set(values).where(eq(permissionTemplates.id, cur.id)).returning();
            await audit({ organizationId: roleOrg.orgId, actorId, targetTemplateId: cur.id, action: 'template.update', before: { name: cur.name, permissions: cur.permissions }, after: { name: row.name, permissions: row.permissions } });
            invalidateTemplate(`org:${cur.id}`);
        } else {
            [row] = await db.insert(permissionTemplates).values({ ...values, organizationId: roleOrg.orgId, createdBy: actorId }).returning();
            await audit({ organizationId: roleOrg.orgId, actorId, targetTemplateId: row.id, action: 'template.create', after: { name: row.name, permissions: row.permissions } });
        }
        return { key: `org:${row.id}`, ...row };
    },

    async deleteTemplate(actorId, id) {
        const actor = await getAccess(actorId);
        const [cur] = await db.select().from(permissionTemplates).where(and(eq(permissionTemplates.id, Number(id)),
            ...(actor.role === 'superadmin' ? [] : [eq(permissionTemplates.organizationId, actor.organizationId || -1)]))).limit(1);
        if (!cur) throw httpError(404, 'Template tidak ditemukan.');
        const key = `org:${cur.id}`;
        const [inUse] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.templateKey, key)).limit(1);
        if (inUse) throw httpError(400, 'Template masih dipakai pengguna — pindahkan pengguna ke template lain dulu.');
        await db.delete(permissionTemplates).where(eq(permissionTemplates.id, cur.id));
        await db.update(organizations).set({ defaultTemplate: null }).where(and(eq(organizations.id, cur.organizationId), eq(organizations.defaultTemplate, key)));
        await audit({ organizationId: cur.organizationId, actorId, targetTemplateId: cur.id, action: 'template.delete', before: { name: cur.name, permissions: cur.permissions } });
        invalidateTemplate(key);
        return { deleted: 1 };
    },

    async setDefaultTemplate(actorId, key) {
        const actor = await getAccess(actorId);
        if (!actor.organizationId) throw httpError(400, 'Akun tanpa organisasi.');
        const t = key ? await templateInfo(key) : null;
        if (key && (!t || t.accountType !== actor.accountType || (!t.system && t.organizationId !== actor.organizationId))) throw httpError(400, 'Template tidak valid untuk organisasi ini.');
        if (t) {
            const chk = canAssign({ actorRole: actor.role, actorAccountType: actor.accountType, actorPerms: actor.perms, targetAccountType: t.accountType, targetPerms: new Set(t.permissions) });
            if (!chk.ok) throw httpError(403, chk.reason);
        }
        await db.update(organizations).set({ defaultTemplate: key || null, updatedAt: new Date() }).where(eq(organizations.id, actor.organizationId));
        await audit({ organizationId: actor.organizationId, actorId, action: 'org.default_template', after: { key } });
        return { defaultTemplate: key || null };
    },

    /** Access of one user, for the editor. */
    async getUserAccess(actorId, targetId) {
        const actor = await getAccess(actorId);
        const target = await getAccess(targetId);
        if (!target) throw httpError(404, 'Pengguna tidak ditemukan.');
        assertSameOrg(actor, target.organizationId);
        const t = await templateInfo(target.templateKey);
        return {
            userId: targetId, accountType: target.accountType, templateKey: target.templateKey, templateName: target.templateName,
            templatePermissions: t?.permissions || [], effective: [...target.perms].sort(),
            grants: target.grants, revokes: target.revokes, legalStatus: target.legalStatus,
        };
    },

    /** Set a user's template + the exact permission set they should have. */
    async setUserAccess(actorId, targetId, { templateKey, permissions }) {
        const actor = await getAccess(actorId);
        const target = await getAccess(targetId);
        if (!target) throw httpError(404, 'Pengguna tidak ditemukan.');
        assertSameOrg(actor, target.organizationId);
        if (target.role === 'superadmin' && actor.role !== 'superadmin') throw httpError(403, 'Akses superadmin tidak dapat diubah.');
        if (targetId === actorId && actor.role !== 'superadmin') throw httpError(400, 'Tidak dapat mengubah hak akses sendiri.');
        const key = templateKey || target.templateKey;
        const t = await templateInfo(key);
        if (!t || t.accountType !== target.accountType || (!t.system && t.organizationId !== target.organizationId)) throw httpError(400, 'Template tidak valid untuk pengguna ini.');
        const desired = new Set((permissions || t.permissions).filter((x) => ALL_PERMS.includes(x)));
        const chk = canAssign({ actorRole: actor.role, actorAccountType: actor.accountType, actorPerms: actor.perms, targetAccountType: target.accountType, targetPerms: desired });
        if (!chk.ok) throw httpError(403, chk.reason);
        const { grants, revokes } = diffFromTemplate(t.permissions, desired);
        // Keep the coarse role column in step with the template, because a few
        // older checks still read it (e.g. Klaim scope, legacy screens).
        const role = target.role === 'superadmin' ? 'superadmin' : (/admin$/.test(key) || desired.has('users.edit') ? 'admin' : (target.role === 'demo' ? 'demo' : 'user'));
        await db.update(userTable).set({ templateKey: key, permGrants: grants, permRevokes: revokes, role, updatedAt: new Date() }).where(eq(userTable.id, targetId));
        await audit({
            organizationId: target.organizationId, actorId, targetUserId: targetId, action: 'user.access',
            before: { templateKey: target.templateKey, effective: [...target.perms].sort() },
            after: { templateKey: key, effective: [...desired].sort() },
        });
        invalidateUser(targetId);
        return this.getUserAccess(actorId, targetId);
    },

    async auditLog(actorId, { limit = 100 } = {}) {
        const actor = await getAccess(actorId);
        const q = db.select().from(permissionAudit);
        const rows = actor.role === 'superadmin'
            ? await q.orderBy(desc(permissionAudit.createdAt)).limit(Math.min(500, Number(limit) || 100))
            : await q.where(eq(permissionAudit.organizationId, actor.organizationId || -1)).orderBy(desc(permissionAudit.createdAt)).limit(Math.min(500, Number(limit) || 100));
        return rows;
    },

    /** Template key for a brand-new member of `orgId` (registration / invite). */
    async templateForNewMember(orgId, accountType, isOrgAdmin) {
        if (isOrgAdmin) return accountType === 'agency' ? 'sys:agency_admin' : 'sys:client_admin';
        if (orgId) {
            const [o] = await db.select({ d: organizations.defaultTemplate }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
            const t = o?.d ? await templateInfo(o.d) : null;
            if (t && t.accountType === accountType) return o.d;
        }
        return accountType === 'agency' ? 'sys:agency_staff' : 'sys:client_user';
    },

    /** Re-evaluate an agency's legal status after documents change. */
    async refreshLegalStatus(orgId) {
        const [o] = await db.select().from(organizations).where(eq(organizations.id, Number(orgId))).limit(1);
        if (!o || o.parentAgencyId != null) return o?.legalStatus || 'active';
        // Only ever promotes setup → active. Existing (pre-RBAC) agencies are
        // 'active' and are never downgraded by uploading a partial set.
        if (o.legalStatus === 'setup' && legalComplete(o)) {
            await db.update(organizations).set({ legalStatus: 'active', updatedAt: new Date() }).where(eq(organizations.id, o.id));
            invalidateOrg(o.id);
            return 'active';
        }
        return o.legalStatus;
    },
};

export default accessService;
