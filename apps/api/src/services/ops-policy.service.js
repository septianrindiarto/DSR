// ─── Agency default lembur & perjalanan dinas (Pengaturan) ──────────────────
// Stored in organizations.ops_policy_default (same shape as a contract policy,
// ops-core.js policyOf). Used by contracts without their own terms
// (effectivePolicy) and by daily orders (dailyRatesOf → Dokumen invoice and
// invoice totals). No business defaults: empty until the agency fills it in.
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { policyOf, policyBlockers, dailyRatesOf } from './ops-core.js';

export async function agencyPolicyDefault(agencyId) {
    if (!agencyId) return null;
    const [o] = await db.select({ p: organizations.opsPolicyDefault }).from(organizations).where(eq(organizations.id, Number(agencyId))).limit(1);
    return o?.p || null;
}

export async function agencyPolicyDefaults(agencyIds) {
    const ids = [...new Set(agencyIds.filter(Boolean).map(Number))];
    if (!ids.length) return new Map();
    const rows = await db.select({ id: organizations.id, p: organizations.opsPolicyDefault }).from(organizations).where(inArray(organizations.id, ids));
    return new Map(rows.map((r) => [r.id, r.p || null]));
}

export async function getOpsDefault(agencyId) {
    const raw = await agencyPolicyDefault(agencyId);
    const policy = policyOf(raw);
    return { agencyId, policy, configured: !!raw, blockers: policyBlockers(policy), dailyRates: dailyRatesOf(raw) };
}

export async function setOpsDefault(agencyId, raw) {
    if (!agencyId) { const e = new Error('Agency tidak ditemukan.'); e.status = 400; throw e; }
    const p = policyOf(raw);
    delete p.source;
    await db.update(organizations).set({ opsPolicyDefault: p, updatedAt: new Date() }).where(eq(organizations.id, Number(agencyId)));
    return getOpsDefault(agencyId);
}
