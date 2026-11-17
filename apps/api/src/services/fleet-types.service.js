// ─── Vehicle types per agency (Armada → Kelola tipe) ─────────────────────────
// organizations.fleet_options.types; rules in fleet-core.js. Renaming a type
// moves the agency's cars to the new name in the same transaction.
import { db } from '../db/index.js';
import { cars, organizations } from '../db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';
import { resolveDefaultAgencyId } from './relationship.service.js';
import { carTypesOf, matchType, planTypeChange, cleanType } from './fleet-core.js';
import { invalidatePricing } from './pricing.service.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });

export async function fleetAgencyId(user) {
    return user?.organizationId || (await resolveDefaultAgencyId()) || null;
}

async function rawOptions(agencyId) {
    if (!agencyId) return null;
    const [o] = await db.select({ f: organizations.fleetOptions }).from(organizations).where(eq(organizations.id, agencyId)).limit(1);
    return o?.f || null;
}

export async function typesForAgency(agencyId) {
    return carTypesOf(await rawOptions(agencyId));
}

const scope = (user) => buildScopeConditions(user, { organizationId: cars.organizationId, isDemo: cars.isDemo, createdBy: cars.createdBy });

async function usage(user) {
    const conds = scope(user);
    const rows = await db.select({ type: cars.type, n: sql`count(*)::int` }).from(cars)
        .where(conds.length ? and(...conds) : undefined).groupBy(cars.type);
    return Object.fromEntries(rows.map((r) => [r.type, Number(r.n)]));
}

export const fleetTypesService = {
    async get(user) {
        const agencyId = await fleetAgencyId(user);
        const raw = await rawOptions(agencyId);
        return { agencyId, types: carTypesOf(raw), custom: !!raw?.types, usage: await usage(user) };
    },

    /** body: { types: [...], renames: [{ from, to }] } */
    async save(user, { types, renames } = {}) {
        const agencyId = await fleetAgencyId(user);
        if (!agencyId) throw httpError(400, 'Agency tidak ditemukan.');
        const plan = planTypeChange({ next: types, renames, usage: await usage(user) });
        if (plan.errors.length) throw httpError(400, plan.errors.join(' '));
        const raw = (await rawOptions(agencyId)) || {};
        await db.transaction(async (tx) => {
            for (const r of plan.renames) {
                const conds = [...scope(user), sql`lower(${cars.type}::text) = lower(${r.from})`];
                await tx.update(cars).set({ type: r.to, updatedAt: new Date() }).where(and(...conds));
            }
            await tx.update(organizations).set({ fleetOptions: { ...raw, types: plan.types }, updatedAt: new Date() }).where(eq(organizations.id, agencyId));
        });
        invalidatePricing(agencyId);   // rate-card categories follow the list
        return this.get(user);
    },

    /** The list's spelling of `type` for this user's agency, or a 400. */
    async assertType(user, type) {
        const list = await typesForAgency(await fleetAgencyId(user));
        const hit = matchType(list, type);
        if (!hit) throw httpError(400, `Tipe "${cleanType(type)}" belum terdaftar. Tambahkan lewat Armada → Kelola tipe.`);
        return hit;
    },

    /** Import: unknown types are added to the agency list (kept in file order). */
    async mergeTypes(user, incoming = []) {
        const agencyId = await fleetAgencyId(user);
        if (!agencyId) return;
        const raw = (await rawOptions(agencyId)) || {};
        const list = carTypesOf(raw);
        const add = incoming.map(cleanType).filter((t) => t && !matchType(list, t));
        if (!add.length) return;
        await db.update(organizations).set({ fleetOptions: { ...raw, types: carTypesOf({ types: [...list, ...add] }) }, updatedAt: new Date() })
            .where(eq(organizations.id, agencyId));
        invalidatePricing(agencyId);
    },
};
