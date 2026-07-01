import { db } from '../db/index.js';
import { organizations, user as userTable, clientAgencyLinks } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { sendEmail } from './email.service.js';

// ─── Client ↔ Agency relationships + affiliate / agency codes (Stage 2 P2) ───
// Many-to-many links live in client_agency_links. status: active | pending
// (agency added a company client, awaiting approval) | archived (removed).

function genCode(len = 8) {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

async function uniqueCode(existsFn) {
    for (let i = 0; i < 12; i++) {
        const code = genCode(8);
        if (!(await existsFn(code))) return code;
    }
    return genCode(10); // extremely unlikely fallback
}

export const relationshipService = {
    async getOrCreateAffiliateCode(userId) {
        const [u] = await db.select({ id: userTable.id, affiliateCode: userTable.affiliateCode })
            .from(userTable).where(eq(userTable.id, userId)).limit(1);
        if (!u) throw new Error('User tidak ditemukan');
        if (u.affiliateCode) return u.affiliateCode;
        const code = await uniqueCode(async (c) => {
            const [d] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.affiliateCode, c)).limit(1);
            return Boolean(d);
        });
        await db.update(userTable).set({ affiliateCode: code, updatedAt: new Date() }).where(eq(userTable.id, userId));
        return code;
    },

    async getOrCreateAgencyCode(orgId) {
        const [o] = await db.select({ id: organizations.id, agencyCode: organizations.agencyCode })
            .from(organizations).where(eq(organizations.id, orgId)).limit(1);
        if (!o) throw new Error('Organisasi tidak ditemukan');
        if (o.agencyCode) return o.agencyCode;
        const code = await uniqueCode(async (c) => {
            const [d] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.agencyCode, c)).limit(1);
            return Boolean(d);
        });
        await db.update(organizations).set({ agencyCode: code, updatedAt: new Date() }).where(eq(organizations.id, orgId));
        return code;
    },

    async listAgenciesForClient(clientOrgId) {
        return db.select({
            linkId: clientAgencyLinks.id, status: clientAgencyLinks.status,
            agencyOrgId: clientAgencyLinks.agencyOrgId, agencyName: organizations.name,
        }).from(clientAgencyLinks)
            .leftJoin(organizations, eq(clientAgencyLinks.agencyOrgId, organizations.id))
            .where(eq(clientAgencyLinks.clientOrgId, clientOrgId));
    },

    async listClientsForAgency(agencyOrgId) {
        return db.select({
            linkId: clientAgencyLinks.id, status: clientAgencyLinks.status,
            clientOrgId: clientAgencyLinks.clientOrgId, clientName: organizations.name,
        }).from(clientAgencyLinks)
            .leftJoin(organizations, eq(clientAgencyLinks.clientOrgId, organizations.id))
            .where(eq(clientAgencyLinks.agencyOrgId, agencyOrgId));
    },

    // Client links to an agency by the agency's code (must be a registered agency).
    async addAgencyByCode(clientOrgId, agencyCode, byUserId) {
        const code = (agencyCode || '').trim().toUpperCase();
        if (!code) { const e = new Error('Kode agency wajib diisi'); e.status = 400; throw e; }
        const [agency] = await db.select({ id: organizations.id })
            .from(organizations).where(eq(organizations.agencyCode, code)).limit(1);
        if (!agency) { const e = new Error('Kode agency tidak ditemukan'); e.status = 404; throw e; }
        await db.insert(clientAgencyLinks)
            .values({ clientOrgId, agencyOrgId: agency.id, status: 'active', createdBy: byUserId })
            .onConflictDoUpdate({
                target: [clientAgencyLinks.clientOrgId, clientAgencyLinks.agencyOrgId],
                set: { status: 'active', approvalToken: null },
            });
        return { agencyOrgId: agency.id };
    },

    // Agency adds a company client → 'pending' link + approval email to the client admin.
    async agencyAddClient(agencyOrgId, clientOrgId, byUserId) {
        const [client] = await db.select({ id: organizations.id, name: organizations.name, adminUserId: organizations.adminUserId })
            .from(organizations).where(eq(organizations.id, clientOrgId)).limit(1);
        if (!client) { const e = new Error('Klien tidak ditemukan'); e.status = 404; throw e; }
        const token = randomUUID().replace(/-/g, '');
        await db.insert(clientAgencyLinks)
            .values({ clientOrgId, agencyOrgId, status: 'pending', approvalToken: token, createdBy: byUserId })
            .onConflictDoUpdate({
                target: [clientAgencyLinks.clientOrgId, clientAgencyLinks.agencyOrgId],
                set: { status: 'pending', approvalToken: token },
            });

        let adminEmail = null;
        if (client.adminUserId) {
            const [adm] = await db.select({ email: userTable.email }).from(userTable).where(eq(userTable.id, client.adminUserId)).limit(1);
            adminEmail = adm?.email || null;
        }
        const [agency] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, agencyOrgId)).limit(1);
        if (adminEmail) {
            const base = process.env.APP_URL || '';
            const approveUrl = `${base}/api/orgs/approve-link?token=${token}`;
            await sendEmail({
                to: adminEmail,
                subject: `Permintaan kemitraan dari ${agency?.name || 'Agency'}`,
                html: `<p><b>${agency?.name || 'Sebuah agency'}</b> ingin menambahkan perusahaan Anda (<b>${client.name}</b>) sebagai klien di DSR Solution.</p>
                       <p>Jika Anda setuju, klik tautan berikut:</p>
                       <p><a href="${approveUrl}">Setujui kemitraan</a></p>
                       <p style="color:#888;font-size:12px">Abaikan email ini jika Anda tidak mengenali permintaan ini.</p>`,
                text: `${agency?.name || 'Sebuah agency'} ingin menambahkan ${client.name} sebagai klien. Setujui: ${approveUrl}`,
            }).catch((e) => console.warn('[relationship] approval email failed:', e?.message));
        }
        return { status: 'pending', emailed: Boolean(adminEmail) };
    },

    async approveLinkByToken(token) {
        if (!token) return null;
        const [updated] = await db.update(clientAgencyLinks)
            .set({ status: 'active', approvalToken: null })
            .where(eq(clientAgencyLinks.approvalToken, token))
            .returning();
        return updated || null;
    },

    async removeLink(linkId, byOrgId) {
        const [link] = await db.select().from(clientAgencyLinks).where(eq(clientAgencyLinks.id, linkId)).limit(1);
        if (!link) return null;
        if (link.clientOrgId !== byOrgId && link.agencyOrgId !== byOrgId) {
            const e = new Error('Tidak diizinkan'); e.status = 403; throw e;
        }
        const [updated] = await db.update(clientAgencyLinks)
            .set({ status: 'archived' }).where(eq(clientAgencyLinks.id, linkId)).returning();
        return updated;
    },

    // Resolve an affiliate code → the agent user + their agency org.
    async resolveAffiliate(affiliateCode) {
        const code = (affiliateCode || '').trim().toUpperCase();
        if (!code) return null;
        const [u] = await db.select({ id: userTable.id, organizationId: userTable.organizationId })
            .from(userTable).where(eq(userTable.affiliateCode, code)).limit(1);
        return u || null;
    },
};
