// ─── /api/auth/register-extended ───────────────────────────────────────────
// Phase 4A — extended signup. Flow forks on whether `inviteCode` is provided:
//
//   • inviteCode given        → user joins the existing organization that
//                               owns the code. role='user', accountType set
//                               to whatever the org's admin is.
//
//   • inviteCode NOT given +
//     companyName + Client    → CREATE new organization → user becomes its
//                               admin (role='admin', accountType='client').
//                               Server generates a unique inviteCode and
//                               emails it to the new admin.
//
//   • Agency signup           → same as before — accountType='agency',
//                               role='admin', no org changes.

import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../auth.js';
import { db } from '../db/index.js';
import { user as userTable, customers, organizations } from '../db/schema.js';
import { eq, sql, or } from 'drizzle-orm';
import { validate } from '../middleware/validate.js';
import { generateUniqueInviteCode, normalizeCompanyName } from '../services/invite-code.service.js';
import { findAvailableDisplayId } from '../services/display-id.service.js';
import { sendInviteCodeEmail } from '../services/email.service.js';

// Phase 4C-1 — for now, every new client org is owned by DSR (org id 1).
// When multi-agency support ships, this becomes a per-request decision based
// on which agency's signup link was used.
const DEFAULT_AGENCY_ID = 1;

const router = Router();

const registerSchema = z.object({
    name: z.string().min(1, 'Nama wajib diisi').max(255),
    email: z.string().email('Email tidak valid'),
    password: z.string().min(6, 'Password minimal 6 karakter'),
    phone: z.string().min(6, 'No. HP wajib diisi').max(50),
    customerType: z.enum(['private', 'company']).default('private'),
    companyName: z.string().max(255).optional().nullable(),
    inviteCode: z.string().max(20).optional().nullable(),
    accountType: z.enum(['client', 'agency']).default('client'),
}).refine(
    (data) => {
        // Company customers need EITHER an invite code OR a company name.
        if (data.customerType === 'company') {
            return Boolean(data.inviteCode?.trim() || data.companyName?.trim());
        }
        return true;
    },
    { message: 'Untuk tipe Perusahaan, isi Nama Perusahaan ATAU Kode Undangan', path: ['companyName'] }
);

router.post('/register-extended', validate(registerSchema), async (req, res, next) => {
    const {
        name, email, password, phone,
        customerType, companyName, inviteCode, accountType,
    } = req.body;

    try {
        // 1. Create the user via Better Auth (handles password hash + sends
        //    the verification email through the sendVerificationEmail hook).
        const result = await auth.api.signUpEmail({
            body: { name, email, password },
        });

        // Better Auth has shipped multiple response shapes across versions:
        //   { user: { id, ... } }
        //   { data: { user: { id, ... } } }
        //   { token, user: { id, ... } }
        // If none of those resolve we fall back to looking up the row by
        // email, which is the unique identifier we just registered with.
        // Without this fallback the post-signup UPDATE matches zero rows
        // and the new user is left with default role and NULL organization_id.
        let newUserId = result?.user?.id || result?.data?.user?.id || result?.id || null;
        if (!newUserId) {
            const [byEmail] = await db.select({ id: userTable.id })
                .from(userTable)
                .where(eq(userTable.email, email))
                .limit(1);
            newUserId = byEmail?.id || null;
            if (newUserId) {
                console.warn('[register-extended] signUpEmail response missing user.id; resolved by email lookup:', newUserId);
            }
        }
        if (!newUserId) {
            console.error('[register-extended] could not resolve newUserId. result keys:', Object.keys(result || {}));
            return res.status(500).json({ error: 'Pendaftaran gagal - user tidak terbuat.' });
        }

        // 2. Decide the user's accountType / role / organizationId.
        let finalAccountType = accountType;       // 'client' or 'agency'
        let finalRole = 'user';                   // default
        let finalOrgId = null;
        let createdOrgInviteCode = null;          // truthy only if we made a new org

        if (accountType === 'agency') {
            // DSR internal staff signup — keep prior behaviour.
            finalRole = 'admin';
            finalAccountType = 'agency';
        } else if (inviteCode && inviteCode.trim()) {
            // Client joining an existing org via invite code.
            const code = inviteCode.trim().toUpperCase();
            const [org] = await db.select().from(organizations)
                .where(eq(organizations.inviteCode, code))
                .limit(1);
            if (!org) {
                return res.status(404).json({
                    error: 'Kode undangan tidak ditemukan. Pastikan kode benar atau minta kode baru dari admin perusahaan Anda.',
                });
            }
            finalOrgId = org.id;
            finalRole = 'user';
            finalAccountType = 'client';
        } else if (customerType === 'company' && companyName && companyName.trim()) {
            // Client creating a NEW org. Check for soft duplicate by BOTH
            // name_normalized (Phase 4A) AND lower(name) (catches legacy rows
            // where name_normalized wasn't backfilled). The lower(name) check
            // is necessary because organizations.name has a UNIQUE constraint —
            // missing either one of these guards lets a UNIQUE violation crash
            // the INSERT below.
            const normalized = normalizeCompanyName(companyName);
            const [dup] = await db.select({ id: organizations.id, name: organizations.name })
                .from(organizations)
                .where(or(
                    eq(organizations.nameNormalized, normalized),
                    sql`LOWER(TRIM(${organizations.name})) = ${normalized}`,
                ))
                .limit(1);
            if (dup) {
                return res.status(409).json({
                    error: `Perusahaan "${dup.name}" sudah terdaftar. Mintalah kode undangan dari admin perusahaan Anda untuk bergabung.`,
                });
            }
            // Phase 4C-1 — find an available display_id. If the default initials
            // collide with another org (different name, same initials on same
            // date), the helper walks per-word letter variations until it
            // lands on a free slot. We never block on display_id collisions —
            // that gate only applies to Gate 1 (same name).
            const { displayId, attempts } = await findAvailableDisplayId(companyName, new Date());
            if (attempts > 1) {
                console.log(`[register-extended] display_id collision for "${companyName}" — assigned "${displayId}" after ${attempts} attempts`);
            }
            // Generate the invite code BEFORE inserting so we can put it on the row.
            const code = await generateUniqueInviteCode();
            const [orgRow] = await db.insert(organizations).values({
                name: companyName.trim(),
                nameNormalized: normalized,
                isActive: true,
                adminUserId: newUserId,
                inviteCode: code,
                displayId,
                parentAgencyId: DEFAULT_AGENCY_ID,
            }).returning({ id: organizations.id });
            finalOrgId = orgRow.id;
            finalRole = 'admin';
            finalAccountType = 'client';
            createdOrgInviteCode = code;
        } else {
            // Private client, no company. role=user, no org link.
            finalRole = 'user';
            finalAccountType = 'client';
        }

        // 3. Persist accountType / role / organizationId on the user row.
        // Use .returning() to confirm the row actually updated. If it did
        // not (newUserId mismatched), fall back to UPDATE BY EMAIL and log
        // loudly. Without this, an empty WHERE silently leaves the new user
        // with default role and NULL organization_id, exactly the symptom
        // reported in the field.
        const updated = await db.update(userTable)
            .set({
                role: finalRole,
                accountType: finalAccountType,
                organizationId: finalOrgId,
            })
            .where(eq(userTable.id, newUserId))
            .returning({ id: userTable.id, role: userTable.role, accountType: userTable.accountType, organizationId: userTable.organizationId });

        if (updated.length === 0) {
            console.warn('[register-extended] UPDATE BY ID affected 0 rows for newUserId=', newUserId, '- retrying by email');
            const retry = await db.update(userTable)
                .set({
                    role: finalRole,
                    accountType: finalAccountType,
                    organizationId: finalOrgId,
                })
                .where(eq(userTable.email, email))
                .returning({ id: userTable.id, role: userTable.role, accountType: userTable.accountType, organizationId: userTable.organizationId });
            if (retry.length === 0) {
                console.error('[register-extended] retry by email ALSO affected 0 rows. Email:', email);
                return res.status(500).json({ error: 'Pendaftaran gagal - akun tidak terupdate. Hubungi admin.' });
            }
            console.warn('[register-extended] retry by email succeeded. Persisted:', retry[0]);
        } else {
            console.log('[register-extended] persisted user row:', updated[0]);
        }

        // 4. Find-or-link the customer record (unchanged from Phase 2.5 —
        //    customers.email is unique, so reuse if it already exists).
        let customerId = null;
        try {
            const [existing] = await db.select({ id: customers.id })
                .from(customers)
                .where(eq(customers.email, email))
                .limit(1);

            if (existing) {
                await db.update(customers)
                    .set({
                        userId: newUserId,
                        name,
                        phone,
                        whatsapp: phone,
                        customerType,
                        companyName: customerType === 'company' ? (companyName || null) : null,
                    })
                    .where(eq(customers.id, existing.id));
                customerId = existing.id;
            } else {
                const [row] = await db.insert(customers).values({
                    userId: newUserId,
                    name,
                    email,
                    phone,
                    whatsapp: phone,
                    customerType,
                    companyName: customerType === 'company' ? (companyName || null) : null,
                }).returning({ id: customers.id });
                customerId = row?.id || null;
            }
        } catch (custErr) {
            console.error('[register-extended] customer link/create failed:', custErr.message);
        }

        // 5. If we just created an org, email the invite code to the new admin.
        if (createdOrgInviteCode) {
            sendInviteCodeEmail({
                to: email,
                adminName: name,
                companyName: companyName.trim(),
                inviteCode: createdOrgInviteCode,
            }).catch(() => { /* logged inside */ });
        }

        res.status(201).json({
            user: {
                id: newUserId,
                name,
                email,
                role: finalRole,
                accountType: finalAccountType,
                organizationId: finalOrgId,
            },
            customerId,
            inviteCode: createdOrgInviteCode,
            message: createdOrgInviteCode
                ? 'Akun admin perusahaan berhasil dibuat. Cek email Anda untuk link aktivasi DAN kode undangan tim.'
                : 'Akun berhasil dibuat. Cek email Anda untuk link aktivasi.',
        });
    } catch (err) {
        console.error('[register-extended] failed:', err.message, err.body || '');
        const raw = err?.body?.message || err?.message || 'Pendaftaran gagal.';
        const lower = raw.toLowerCase();
        if (
            lower.includes('exists') ||
            lower.includes('duplicate') ||
            lower.includes('failed to create user')
        ) {
            return res.status(409).json({
                error: 'Email sudah terdaftar. Coba masuk dengan email tersebut, atau pakai email lain.',
            });
        }
        return res.status(500).json({ error: `Pendaftaran gagal: ${raw}` });
    }
});

export default router;
