// ─── Pricing service — rate cards, city zones, corporate rates, quotes ──────
// Rules live in pricing-core.js (pure). This file loads/saves per-agency data
// (cached 60 s; invalidated on save) and decides WHICH agencies quote:
//   agency staff   → own agency (+ corporate rate of the chosen client)
//   client user    → every active agency serving the client company (its
//                    parent agency + client_agency_links) with the
//                    company's corporate rates — side-by-side comparison
//   public visitor → the default/home agency (or the affiliate's agency),
//                    only when that agency publishes its prices
// Agencies still in legal "setup" mode never quote to clients/public.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import { rateCards, zoneCities, corporateRates, organizations, clientAgencyLinks, orders, cars } from '../db/schema.js';
import { and, eq, inArray, asc } from 'drizzle-orm';
import * as P from './pricing-core.js';
import { resolveDefaultAgencyId } from './relationship.service.js';
import { carTypesOf } from './fleet-core.js';

const TTL = 60_000;
const cache = new Map(); // agencyId → { at, data }

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

export async function loadAgencyPricing(agencyId) {
    const hit = cache.get(agencyId);
    if (hit && Date.now() - hit.at < TTL) return hit.data;
    const [org] = await db.select({ id: organizations.id, name: organizations.name, legalStatus: organizations.legalStatus, settings: organizations.pricingSettings, fleet: organizations.fleetOptions })
        .from(organizations).where(eq(organizations.id, agencyId)).limit(1);
    if (!org) return null;
    const [cards, zones] = await Promise.all([
        db.select().from(rateCards).where(eq(rateCards.organizationId, agencyId)),
        db.select().from(zoneCities).where(eq(zoneCities.organizationId, agencyId)).orderBy(asc(zoneCities.zone), asc(zoneCities.city)),
    ]);
    const data = {
        agencyId, name: org.name, legalStatus: org.legalStatus,
        settings: { ...P.DEFAULT_PRICING_SETTINGS, ...(org.settings || {}) },
        rateCards: cards.map((c) => ({ ...c, pricePerDay: Number(c.pricePerDay) })),
        zoneCities: zones,
        // Rate-card categories = built-in list + the agency's own vehicle types.
        categories: P.categoriesWith(carTypesOf(org.fleet)),
    };
    cache.set(agencyId, { at: Date.now(), data });
    return data;
}
export const invalidatePricing = (agencyId) => cache.delete(agencyId);

async function corporateFor(agencyId, clientOrgId) {
    if (!agencyId || !clientOrgId) return [];
    const rows = await db.select().from(corporateRates)
        .where(and(eq(corporateRates.agencyOrgId, agencyId), eq(corporateRates.clientOrgId, clientOrgId)));
    return rows.map((r) => ({ ...r, pricePerDay: r.pricePerDay == null ? null : Number(r.pricePerDay), discountPct: r.discountPct == null ? null : Number(r.discountPct) }));
}

/** Agencies serving a client company (parent agency + active links). */
async function agenciesOfClient(clientOrgId) {
    const [org] = await db.select({ parent: organizations.parentAgencyId }).from(organizations).where(eq(organizations.id, clientOrgId)).limit(1);
    const links = await db.select({ id: clientAgencyLinks.agencyOrgId }).from(clientAgencyLinks)
        .where(and(eq(clientAgencyLinks.clientOrgId, clientOrgId), eq(clientAgencyLinks.status, 'active')));
    return [...new Set([org?.parent, ...links.map((l) => l.id)].filter(Boolean))];
}

const isClient = (u) => u && (u.accountType === 'client' || u.role === 'client' || u.role === 'client_admin');

export const pricingService = {
    meta() {
        return { categories: P.PRICE_CATEGORIES, packages: P.PRICE_PACKAGES, zones: P.ZONES, defaults: P.DEFAULT_PRICING_SETTINGS };
    },

    // ─── Agency configuration ──────────────────────────────────────────
    async getConfig(agencyId) {
        const d = await loadAgencyPricing(agencyId);
        if (!d) throw httpError(404, 'Agency tidak ditemukan.');
        return { ...this.meta(), categories: d.categories, settings: d.settings, rateCards: d.rateCards, zoneCities: d.zoneCities };
    },

    /** rows: [{ category, package, zone, carModel?, pricePerDay }] — empty/0 price deletes that cell. */
    async saveRateCards(agencyId, rows, userId) {
        const clean = [];
        const cats = (await loadAgencyPricing(agencyId))?.categories || P.PRICE_CATEGORIES;
        for (const r of rows || []) {
            const category = P.normalizeCategory(r.category, cats), pkg = P.normalizePackage(r.package), zone = Number(r.zone);
            if (!category || !pkg || !P.ZONES.includes(zone)) throw httpError(400, `Baris tarif tidak valid: ${r.category} / ${r.package} / zona ${r.zone}`);
            clean.push({ category, package: pkg, zone, carModel: String(r.carModel || '').trim().slice(0, 100), price: Number(r.pricePerDay) || 0 });
        }
        await db.transaction(async (tx) => {
            for (const r of clean) {
                const key = and(eq(rateCards.organizationId, agencyId), eq(rateCards.category, r.category), eq(rateCards.package, r.package),
                    eq(rateCards.zone, r.zone), eq(rateCards.carModel, r.carModel));
                if (!(r.price > 0)) { await tx.delete(rateCards).where(key); continue; }
                await tx.insert(rateCards).values({ organizationId: agencyId, category: r.category, package: r.package, zone: r.zone, carModel: r.carModel, pricePerDay: String(r.price), updatedBy: userId, updatedAt: new Date() })
                    .onConflictDoUpdate({ target: [rateCards.organizationId, rateCards.category, rateCards.package, rateCards.zone, rateCards.carModel], set: { pricePerDay: String(r.price), updatedBy: userId, updatedAt: new Date() } });
            }
        });
        invalidatePricing(agencyId);
        return this.getConfig(agencyId);
    },

    /** Replace the whole city list. cities: [{ city, zone }] */
    async saveZones(agencyId, cities) {
        const seen = new Map();
        for (const c of cities || []) {
            const city = String(c.city || '').trim().slice(0, 100), norm = P.normCity(city), zone = Number(c.zone);
            if (!norm) continue;
            if (!P.ZONES.includes(zone)) throw httpError(400, `Zona untuk ${city} harus 1–4.`);
            seen.set(norm, { organizationId: agencyId, city, cityNorm: norm, zone });
        }
        await db.transaction(async (tx) => {
            await tx.delete(zoneCities).where(eq(zoneCities.organizationId, agencyId));
            if (seen.size) await tx.insert(zoneCities).values([...seen.values()]);
        });
        invalidatePricing(agencyId);
        return this.getConfig(agencyId);
    },

    async saveSettings(agencyId, s) {
        const settings = {
            overtimePerHour: Math.max(0, Number(s.overtimePerHour) || 0),
            overnightPerNight: Math.max(0, Number(s.overnightPerNight) || 0),
            rounding: [0, 100, 500, 1000, 5000, 10000].includes(Number(s.rounding)) ? Number(s.rounding) : 1000,
            publicPrices: s.publicPrices !== false,
            defaultZone: P.ZONES.includes(Number(s.defaultZone)) ? Number(s.defaultZone) : null,
        };
        await db.update(organizations).set({ pricingSettings: settings, updatedAt: new Date() }).where(eq(organizations.id, agencyId));
        invalidatePricing(agencyId);
        return this.getConfig(agencyId);
    },

    async getCorporate(agencyId, clientOrgId) {
        return { clientOrgId: Number(clientOrgId), rates: await corporateFor(agencyId, Number(clientOrgId)) };
    },

    /** Replace a client's corporate rates. rates: [{ category, package, zone (0=all), pricePerDay?, discountPct?, validUntil? }] */
    async saveCorporate(agencyId, clientOrgId, rates, userId) {
        const rows = [];
        const cats = (await loadAgencyPricing(agencyId))?.categories || P.PRICE_CATEGORIES;
        for (const r of rates || []) {
            const category = P.normalizeCategory(r.category, cats), pkg = P.normalizePackage(r.package), zone = Number(r.zone) || 0;
            const price = Number(r.pricePerDay) || 0, disc = Number(r.discountPct) || 0;
            if (!category || !pkg || !(zone === 0 || P.ZONES.includes(zone))) throw httpError(400, 'Baris tarif korporat tidak valid.');
            if (!(price > 0) && !(disc > 0)) continue;
            if (disc >= 100) throw httpError(400, 'Diskon harus di bawah 100%.');
            rows.push({ agencyOrgId: agencyId, clientOrgId: Number(clientOrgId), category, package: pkg, zone,
                pricePerDay: price > 0 ? String(price) : null, discountPct: price > 0 ? null : String(disc),
                validUntil: r.validUntil || null, updatedBy: userId, updatedAt: new Date() });
        }
        await db.transaction(async (tx) => {
            await tx.delete(corporateRates).where(and(eq(corporateRates.agencyOrgId, agencyId), eq(corporateRates.clientOrgId, Number(clientOrgId))));
            if (rows.length) await tx.insert(corporateRates).values(rows);
        });
        return this.getCorporate(agencyId, clientOrgId);
    },

    // ─── Quotes ────────────────────────────────────────────────────────
    /** Price one booking for one agency. Returns null when the agency is unknown. */
    async quoteForAgency(agencyId, { clientOrgId = null, items, pickupDate, returnDate }) {
        const d = await loadAgencyPricing(agencyId);
        if (!d) return null;
        const corp = await corporateFor(agencyId, clientOrgId);
        const q = P.computeQuote({ items, pickupDate, returnDate, rateCards: d.rateCards, zoneCities: d.zoneCities, corporateRates: corp, settings: d.settings, categories: d.categories });
        return { agencyId, agencyName: d.name, corporate: corp.length > 0, ...q };
    },

    /** POST /api/pricing/quote — who may see which agency's price is decided here. */
    async quote(user, { items, pickupDate, returnDate, clientOrgId = null, agencyId = null }) {
        if (!Array.isArray(items) || !items.length) throw httpError(400, 'Kendaraan wajib diisi.');
        let agencies = [], client = null;
        if (user?.role === 'superadmin') {
            agencies = agencyId ? [Number(agencyId)] : [await resolveDefaultAgencyId()].filter(Boolean);
            client = clientOrgId ? Number(clientOrgId) : null;
        } else if (user && !isClient(user)) {          // agency staff: own agency only
            agencies = user.organizationId ? [user.organizationId] : [];
            client = clientOrgId ? Number(clientOrgId) : null;
        } else if (user?.organizationId) {             // client company user
            client = user.organizationId;
            agencies = await agenciesOfClient(client);
            if (!agencies.length) agencies = [await resolveDefaultAgencyId()].filter(Boolean);
        } else {                                       // public / private client
            agencies = [agencyId ? Number(agencyId) : await resolveDefaultAgencyId()].filter(Boolean);
        }
        const out = [];
        for (const id of agencies.slice(0, 10)) {
            const d = await loadAgencyPricing(id);
            if (!d) continue;
            const staffOfAgency = user && !isClient(user) && (user.role === 'superadmin' || user.organizationId === id);
            if (!staffOfAgency && d.legalStatus === 'setup') continue;
            if (!staffOfAgency && !client && d.settings.publicPrices === false) continue;
            const q = await this.quoteForAgency(id, { clientOrgId: client, items, pickupDate, returnDate });
            if (q) out.push(q);
        }
        out.sort((a, b) => (b.complete - a.complete) || (a.total - b.total));
        // Marketplace: show each agency's rating next to its price.
        if (out.length) {
            const { marketplaceService } = await import('./marketplace.service.js');
            const ratings = await marketplaceService.ratingsFor(out.map((q) => q.agencyId)).catch(() => ({}));
            for (const q of out) q.rating = ratings[q.agencyId] || null;
        }
        return { quotes: out };
    },

    /**
     * Server-side price for new booking rows (order creation / claim / approval).
     * vehicles: [{ category, package, destination, carModel, carPrice, overtimeHours, overnightNights }]
     * Returns [{ unitPrice, total, source, zone } | null] in the same order.
     */
    async priceRows(agencyId, clientOrgId, pickupDate, returnDate, vehicles) {
        if (!agencyId || !vehicles?.length) return vehicles.map(() => null);
        const q = await this.quoteForAgency(agencyId, { clientOrgId, pickupDate, returnDate, items: vehicles.map((v) => ({ ...v, quantity: 1 })) });
        if (!q) return vehicles.map(() => null);
        return q.items.map((it) => (it.perUnit > 0 ? { unitPrice: it.unitPrice, total: it.perUnit, source: it.source, zone: it.zone } : null));
    },
};

/** "Permintaan Kendaraan: MPV (…)" in order notes → "MPV" */
export function requestedCategoryFromNotes(notes) {
    const m = String(notes || '').match(/Permintaan Kendaraan:\s*([^\n(]+)/i);
    return m ? m[1].trim() : null;
}

/**
 * Price waiting/claimed rows that still have no price, with the owning
 * agency's rate card (+ the client's corporate rate). Rows with a price are
 * left alone (an agency may have negotiated it already).
 */
export async function priceUnpricedRows(rows, agencyId) {
    const todo = (rows || []).filter((r) => !(Number(r.totalPrice) > 0));
    if (!agencyId || !todo.length) return 0;
    const byCode = new Map();
    for (const r of todo) { if (!byCode.has(r.orderNumber)) byCode.set(r.orderNumber, []); byCode.get(r.orderNumber).push(r); }
    let n = 0;
    for (const list of byCode.values()) {
        const carIds = list.map((r) => r.carId).filter(Boolean);
        const carRows = carIds.length ? await db.select().from(cars).where(inArray(cars.id, carIds)) : [];
        const carById = new Map(carRows.map((c) => [c.id, c]));
        const head = list[0];
        const priced = await pricingService.priceRows(agencyId, head.organizationId, head.pickupDate, head.returnDate, list.map((r) => {
            const car = carById.get(r.carId);
            return {
                category: car?.type || requestedCategoryFromNotes(r.notes), package: r.package, destination: r.destination,
                carModel: car ? `${car.brand || ''} ${car.name || ''}`.trim() : null, carPrice: car?.price,
                overtimeHours: r.overtimeHours, overnightNights: r.overnightNights,
            };
        }));
        for (let i = 0; i < list.length; i++) {
            const p = priced[i];
            if (!p) continue;
            await db.update(orders).set({ dailyRate: String(p.unitPrice), totalPrice: String(p.total), priceSource: p.source, priceZone: p.zone, updatedAt: new Date() })
                .where(eq(orders.id, list[i].id));
            n++;
        }
    }
    return n;
}

export default pricingService;
