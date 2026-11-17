import { db } from '../db/index.js';
import { orders, cars, customers, drivers, clientAgencyLinks, organizations } from '../db/schema.js';
import { eq, ilike, or, and, asc, desc, sql, gte, lte, like, isNull, inArray } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';
import { priceUnpricedRows } from './pricing.service.js';
import { decryptDriver } from './driver.service.js';
import { resolveDefaultAgencyId } from './relationship.service.js';

/**
 * Generate a sequential order number based on customer type.
 *   - customer.customerType === 'company' -> prefix "C" (e.g. C001, C002)
 *   - otherwise                           -> prefix "P" (e.g. P001, P002)
 *
 * Falls back to "P" when the customer cannot be loaded.
 *
 * Tier 2 multi-car booking: this returns ONE code per call. For a booking
 * that creates N rows, call this ONCE at the route level and pass the
 * resulting code into create() for each of the N rows so they all share
 * it. The DB UNIQUE constraint on order_number was dropped — duplicates
 * are now intentional and represent multi-car bookings.
 *
 * Exported via orderService.generateOrderNumber so routes can use it.
 */
// prefix override: 'M' = monthly contract booking (M001…), see contracts.service.
export async function generateOrderNumber(customerId, { prefix: forced = null } = {}) {
    let prefix = forced || 'P';
    try {
        if (customerId && !forced) {
            const rows = await db
                .select({ customerType: customers.customerType })
                .from(customers)
                .where(eq(customers.id, customerId))
                .limit(1);
            if (rows.length && rows[0].customerType === 'company') {
                prefix = 'C';
            }
        }
    } catch {
        // leave prefix as default
    }

    // Find max existing sequence for this prefix (e.g. C001, C002, ...)
    const rows = await db
        .select({ orderNumber: orders.orderNumber })
        .from(orders)
        .where(like(orders.orderNumber, `${prefix}%`));

    let max = 0;
    for (const r of rows) {
        const match = new RegExp(`^${prefix}(\\d+)$`).exec(r.orderNumber || '');
        if (match) {
            const n = parseInt(match[1], 10);
            if (n > max) max = n;
        }
    }
    const next = String(max + 1).padStart(3, '0');
    return `${prefix}${next}`;
}

// Map Indonesian (and a few common English) labels back to the canonical enum
// values stored in the DB, so a free-text search like "selesai" or "perusahaan"
// also hits rows whose status / customerType is "completed" / "company".
const SEARCH_SYNONYMS = {
    // order.status
    'selesai': 'completed',
    'menunggu': 'pending',
    'dikonfirmasi': 'confirmed',
    'konfirmasi': 'confirmed',
    'aktif': 'active',
    'berjalan': 'active',
    'dibatalkan': 'cancelled',
    'batal': 'cancelled',
    // customers.customerType
    'pribadi': 'private',
    'perusahaan': 'company',
};

function expandSearchTerms(input) {
    const terms = new Set([input]);
    const lower = String(input || '').trim().toLowerCase();
    if (SEARCH_SYNONYMS[lower]) terms.add(SEARCH_SYNONYMS[lower]);
    return Array.from(terms);
}

const sortFields = {
    orderNumber: orders.orderNumber,
    totalPrice: orders.totalPrice,
    status: orders.status,
    pickupDate: orders.pickupDate,
    returnDate: orders.returnDate,
    createdAt: orders.createdAt,
    totalDays: orders.totalDays,
    package: orders.package,
    destination: orders.destination,
    bailout: orders.bailout,
};

// "Budi Santoso" → "Budi S."; "081234567890" → "0812•••••890".
const shortName = (n) => {
    const parts = String(n || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return null;
    return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
};
const maskPhone = (p) => {
    const d = String(p || '').replace(/\s+/g, '');
    return d.length >= 7 ? `${d.slice(0, 4)}•••••${d.slice(-3)}` : (d ? '•••' : null);
};
export function maskClaimable(o) {
    const c = o.customer || {};
    return {
        ...o,
        customerName: shortName(o.customerName),
        notes: null,
        customer: c ? {
            id: c.id, customerType: c.customerType, companyName: c.companyName,
            name: shortName(c.name), phone: maskPhone(c.phone || c.whatsapp), whatsapp: null,
            email: null, address: null, job: null, notes: null,
        } : null,
        contactHidden: true,
    };
}

// Rekap Order mapping columns (owner 2026-11-09): which faktur pajak, which
// surat pengantar (orders.invoice_letter_number) and which contract a row
// belongs to. Contract: orders.contract_id, else the monthly billing (M) or
// ops form (L/R) that produced the code. Empty when a row has none.
const contractIdExpr = sql`COALESCE(${orders.contractId},
    (SELECT lb.contract_id FROM lease_billings lb WHERE lb.order_number = ${orders.orderNumber} LIMIT 1),
    (SELECT oe.contract_id FROM ops_entries oe WHERE oe.code = ${orders.orderNumber} LIMIT 1))`;
const mappingCols = {
    contractRef: sql`${contractIdExpr}`.mapWith(Number),
    contractNumber: sql`(SELECT lc.contract_number FROM lease_contracts lc WHERE lc.id = ${contractIdExpr})`,
    fakturId: sql`(SELECT i.faktur_id FROM invoices i WHERE i.id = ${orders.invoiceId})`,
    fakturNsfp: sql`(SELECT fp.nsfp FROM invoices i JOIN faktur_pajak fp ON fp.id = i.faktur_id WHERE i.id = ${orders.invoiceId})`,
    fakturStatus: sql`(SELECT fp.status FROM invoices i JOIN faktur_pajak fp ON fp.id = i.faktur_id WHERE i.id = ${orders.invoiceId})`,
    // M code: invoice date = the contract month's tanggal tagih (contract-billing.service).
    contractInvoiceDate: sql`(SELECT lub.detail->>'invoiceDate' FROM lease_unit_billings lub WHERE lub.order_id = ${orders.id} LIMIT 1)`,
    // M detail form status (open | submitted | approved | rejected) — only approved can be invoiced.
    contractFormStatus: sql`(SELECT lub.status FROM lease_unit_billings lub WHERE lub.order_id = ${orders.id} LIMIT 1)`,
};
const withMapping = (r) => ({
    contractId: r.contractRef || null, contractNumber: r.contractNumber || null,
    fakturId: r.fakturId || null, fakturNsfp: r.fakturNsfp || null, fakturStatus: r.fakturStatus || null,
    contractInvoiceDate: r.contractInvoiceDate || null,
    contractFormStatus: r.contractFormStatus || null,
});

export const orderService = {
    async findAll({ search, status, sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 20, scopeUser = null }) {
        const offset = (page - 1) * limit;
        const conditions = [];
        if (status && status !== 'all') conditions.push(eq(orders.status, status));

        // Data isolation — org for agency/company admins, customer.user_id for
        // plain clients. `ownerUserId: customers.userId` makes the scope helper
        // emit  WHERE customers.user_id = req.user.id  for client role.
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: orders.organizationId,
            isDemo: orders.isDemo,
            createdBy: orders.createdBy,
            ownerUserId: customers.userId,
            claimedByAgencyId: orders.claimedByAgencyId,
        });
        conditions.push(...scopeConds);

        let query = db
            .select({
                order: orders,
                car: cars,
                customer: customers,
                driver: drivers,
                ...mappingCols,
            })
            .from(orders)
            .leftJoin(cars, eq(orders.carId, cars.id))
            .leftJoin(customers, eq(orders.customerId, customers.id))
            .leftJoin(drivers, eq(orders.driverId, drivers.id));

        if (search) {
            // Expand the user's term to include enum synonyms (e.g. "selesai" → "completed")
            const expanded = expandSearchTerms(search);
            const perTermClauses = expanded.map(raw => {
                const term = `%${raw}%`;
                return or(
                    // Order columns
                    ilike(orders.orderNumber, term),
                    ilike(orders.package, term),
                    ilike(orders.destination, term),
                    ilike(orders.notes, term),
                    ilike(orders.pickupLocation, term),
                    sql`CAST(${orders.status} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.totalDays} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.totalPrice} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.dailyRate} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.overnightNights} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.overtimeHours} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.bailout} AS TEXT) ILIKE ${term}`,
                    sql`TO_CHAR(${orders.pickupDate}, 'YYYY-MM-DD') ILIKE ${term}`,
                    sql`TO_CHAR(${orders.returnDate}, 'YYYY-MM-DD') ILIKE ${term}`,
                    // Customer columns
                    ilike(customers.name, term),
                    ilike(customers.companyName, term),
                    ilike(customers.phone, term),
                    ilike(customers.whatsapp, term),
                    ilike(customers.email, term),
                    sql`CAST(${customers.customerType} AS TEXT) ILIKE ${term}`,
                    // Car columns
                    ilike(cars.name, term),
                    ilike(cars.brand, term),
                    ilike(cars.licensePlate, term),
                    // Driver columns
                    ilike(drivers.name, term),
                    ilike(drivers.phone, term)
                );
            });
            conditions.push(perTermClauses.length === 1 ? perTermClauses[0] : or(...perTermClauses));
        }

        if (conditions.length > 0) {
            query = query.where(and(...conditions));
        }

        const orderField = sortFields[sortBy] || orders.createdAt;
        const orderDir = sortOrder === 'asc' ? asc(orderField) : desc(orderField);

        const results = await query.orderBy(orderDir).limit(limit).offset(offset);

        // Count total
        let countQuery = db.select({ count: sql`count(*)` }).from(orders);
        if (status && status !== 'all') {
            countQuery = countQuery.where(eq(orders.status, status));
        }
        const countResult = await countQuery;

        return {
            data: results.map(r => ({
                ...r.order,
                ...withMapping(r),
                car: r.car,
                customer: r.customer,
                driver: decryptDriver(r.driver),
            })),
            total: Number(countResult[0].count),
            page,
            limit,
        };
    },

    async findAllRaw(scopeUser = null) {
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: orders.organizationId,
            isDemo: orders.isDemo,
            createdBy: orders.createdBy,
            ownerUserId: customers.userId,
            claimedByAgencyId: orders.claimedByAgencyId,
        });

        let query = db
            .select({
                order: orders,
                car: cars,
                customer: customers,
                driver: drivers,
                ...mappingCols,
            })
            .from(orders)
            .leftJoin(cars, eq(orders.carId, cars.id))
            .leftJoin(customers, eq(orders.customerId, customers.id))
            .leftJoin(drivers, eq(orders.driverId, drivers.id));

        if (scopeConds.length > 0) query = query.where(and(...scopeConds));
        const results = await query.orderBy(desc(orders.createdAt));

        return results.map(r => ({
            ...r.order,
            ...withMapping(r),
            car: r.car,
            customer: r.customer,
            driver: decryptDriver(r.driver),
        }));
    },

    async findById(id) {
        const result = await db
            .select({
                order: orders,
                car: cars,
                customer: customers,
                driver: drivers,
            })
            .from(orders)
            .leftJoin(cars, eq(orders.carId, cars.id))
            .leftJoin(customers, eq(orders.customerId, customers.id))
            .leftJoin(drivers, eq(orders.driverId, drivers.id))
            .where(eq(orders.id, id));

        if (result.length === 0) return null;
        const r = result[0];
        return { ...r.order, car: r.car, customer: r.customer, driver: decryptDriver(r.driver) };
    },

    async create(data) {
        const orderNumber = data.orderNumber || (await generateOrderNumber(data.customerId));
        const result = await db.insert(orders).values({
            ...data,
            orderNumber,
        }).returning();

        // Update customer total orders
        if (data.customerId) {
            await db.execute(sql`
                UPDATE customers
                SET total_orders = total_orders + 1,
                    last_order_date = NOW(),
                    updated_at = NOW()
                WHERE id = ${data.customerId}
            `);
        }

        return result[0];
    },

    async update(id, data) {
        const updateData = { ...data, updatedAt: new Date() };
        // Never allow orderNumber / id to be overwritten via update
        delete updateData.id;
        delete updateData.orderNumber;
        delete updateData.createdAt;
        const result = await db.update(orders).set(updateData).where(eq(orders.id, id)).returning();
        return result[0];
    },

    async remove(id) {
        const existing = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
        if (existing.length === 0) return null;
        await db.delete(orders).where(eq(orders.id, id));
        return existing[0];
    },

    async updateStatus(id, status, userId) {
        const updateData = { status, updatedAt: new Date() };
        if (status === 'confirmed' && userId) {
            updateData.approvedBy = userId;
            updateData.approvedAt = new Date();
        }
        const result = await db.update(orders).set(updateData).where(eq(orders.id, id)).returning();
        return result[0];
    },

    async assignDriver(id, driverId) {
        const result = await db.update(orders).set({ driverId, updatedAt: new Date() }).where(eq(orders.id, id)).returning();
        return result[0];
    },

    // Tier 2 multi-vehicle: assign a (possibly different) driver to each car
    // row of a booking in one shot. `assignments` is [{ orderId, driverId }];
    // driverId null/0 clears the assignment for that row. Returns the updated
    // rows. Runs each update independently so one bad id can't roll back the
    // rest — the caller reports how many succeeded.
    async assignDriversBulk(assignments) {
        const updated = [];
        for (const a of Array.isArray(assignments) ? assignments : []) {
            const id = Number(a?.orderId);
            if (!id) continue;
            const driverId = a?.driverId ? Number(a.driverId) : null;
            const r = await db.update(orders)
                .set({ driverId, updatedAt: new Date() })
                .where(eq(orders.id, id))
                .returning();
            if (r[0]) updated.push(r[0]);
        }
        return updated;
    },

    // Tier 2 multi-vehicle: assign an actual fleet car to each vehicle row of
    // a booking. `assignments` is [{ orderId, carId }]; carId null/0 clears it.
    // When a car is assigned to a row that is still UNPRICED (totalPrice 0 /
    // null — typical for category-only requests from the booking form), the
    // row's dailyRate/totalPrice are filled from the car's list price ×
    // totalDays. Rows that already carry a (negotiated) price are left as-is so
    // a re-assignment never silently clobbers agreed pricing.
    async assignCarsBulk(assignments) {
        const updated = [];
        for (const a of Array.isArray(assignments) ? assignments : []) {
            const id = Number(a?.orderId);
            if (!id) continue;
            const carId = a?.carId ? Number(a.carId) : null;

            const [existing] = await db
                .select({ totalDays: orders.totalDays, totalPrice: orders.totalPrice })
                .from(orders)
                .where(eq(orders.id, id))
                .limit(1);
            if (!existing) continue;

            const patch = { carId, updatedAt: new Date() };

            if (carId) {
                const currentPrice = Number(existing.totalPrice || 0);
                if (!(currentPrice > 0)) {
                    const [car] = await db
                        .select({ price: cars.price })
                        .from(cars)
                        .where(eq(cars.id, carId))
                        .limit(1);
                    if (car) {
                        const rate = Number(car.price || 0);
                        const days = Number(existing.totalDays || 1);
                        patch.dailyRate = String(rate);
                        patch.totalPrice = String(rate * days);
                    }
                }
            }

            const r = await db.update(orders).set(patch).where(eq(orders.id, id)).returning();
            if (r[0]) updated.push(r[0]);
        }
        return updated;
    },

    // Tier 2 multi-vehicle: cancel an ENTIRE booking — every row that shares
    // the order code. Order codes are generated from a single global sequence,
    // so a code maps to exactly one booking and matching by code alone is safe
    // (it can't bleed into another org's booking). Already-finished or
    // already-cancelled rows are left untouched. Returns the rows it changed.
    async cancelByOrderNumber(orderNumber) {
        if (!orderNumber) return [];
        const result = await db.update(orders)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(and(
                eq(orders.orderNumber, orderNumber),
                sql`${orders.status} NOT IN ('completed', 'cancelled')`,
            ))
            .returning();
        return result;
    },

    // Tier 2 multi-vehicle: combined per-row update for the booking "Action"
    // form — set car, driver, and price for each vehicle row in one request.
    // `items` is [{ orderId, carId?, driverId?, totalPrice? }]. carId/driverId
    // null clears them. When totalPrice is provided, dailyRate is derived from
    // it (price ÷ totalDays). Only the keys present on each item are touched.
    async updateBookingItemsBulk(items) {
        const updated = [];
        for (const it of Array.isArray(items) ? items : []) {
            const id = Number(it?.orderId);
            if (!id) continue;

            const [existing] = await db
                .select({ totalDays: orders.totalDays })
                .from(orders)
                .where(eq(orders.id, id))
                .limit(1);
            if (!existing) continue;

            const patch = { updatedAt: new Date() };
            if (it.carId !== undefined) patch.carId = it.carId ? Number(it.carId) : null;
            if (it.driverId !== undefined) patch.driverId = it.driverId ? Number(it.driverId) : null;
            if (it.totalPrice !== undefined && it.totalPrice !== null && String(it.totalPrice) !== '') {
                const price = Number(it.totalPrice) || 0;
                const days = Number(existing.totalDays || 1);
                patch.totalPrice = String(price);
                patch.dailyRate = String(days > 0 ? price / days : price);
            }

            const r = await db.update(orders).set(patch).where(eq(orders.id, id)).returning();
            if (r[0]) updated.push(r[0]);
        }
        return updated;
    },

    // Tier 2 multi-vehicle: delete an ENTIRE booking — every row sharing the
    // order code. Returns the deleted rows (empty if the code wasn't found).
    async removeByOrderNumber(orderNumber) {
        if (!orderNumber) return [];
        const existing = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber));
        if (existing.length === 0) return [];
        await db.delete(orders).where(eq(orders.orderNumber, orderNumber));
        return existing;
    },

    // Stage 2 — claim an entire booking (all rows sharing the code). Gated to
    // admin+ at the route. An agency claimer takes fulfilment responsibility
    // (and, per §10 scenario 2, becomes that client's agency); a client-admin
    // claimer links the booking to their company.
    async claimByOrderNumber(orderNumber, user) {
        if (!orderNumber || !user) return [];
        const isAgency = user.accountType === 'agency';
        const patch = { claimedByUserId: user.id, updatedAt: new Date() };
        if (isAgency) {
            patch.claimedByAgencyId = user.organizationId || null;
            patch.claimStatus = 'agency_claimed';
            patch.claimedAt = new Date();
        } else {
            if (user.organizationId) patch.organizationId = user.organizationId;
            patch.claimStatus = 'client_claimed';
        }
        const updated = await db.update(orders)
            .set(patch)
            .where(eq(orders.orderNumber, orderNumber))
            .returning();

        // §10 scenario 2: an agency claiming a company order becomes that
        // client's agency (create the link if missing).
        if (isAgency && user.organizationId) {
            const clientOrgIds = [...new Set(
                updated.map(o => o.organizationId).filter(Boolean).filter(id => id !== user.organizationId)
            )];
            for (const clientOrgId of clientOrgIds) {
                await db.insert(clientAgencyLinks)
                    .values({ clientOrgId, agencyOrgId: user.organizationId, status: 'active', createdBy: user.id })
                    .onConflictDoNothing();
            }
            // Pricing engine: rows still at Rp0 get this agency's rate (best-effort).
            await priceUnpricedRows(updated, user.organizationId).catch((e) => console.warn('[pricing] claim pricing failed:', e.message));
        }
        return updated;
    },

    // Stage 2 — claim SEVERAL bookings at once (bulk claim from Klaim Order).
    // SET-BASED for speed: one UPDATE for every selected code and one INSERT
    // for all the agency↔client links. (The earlier per-code loop did 1+ DB
    // round-trips per booking — against Neon that's hundreds of network hops
    // and times out for large selections.)
    async claimManyByOrderNumber(orderNumbers, user) {
        const codes = [...new Set((Array.isArray(orderNumbers) ? orderNumbers : [])
            .map((c) => String(c || '').trim()).filter(Boolean))];
        if (codes.length === 0 || !user) return { bookings: 0, vehicles: 0, results: [] };

        const isAgency = user.accountType === 'agency';
        const patch = { claimedByUserId: user.id, updatedAt: new Date() };
        if (isAgency) {
            patch.claimedByAgencyId = user.organizationId || null;
            patch.claimStatus = 'agency_claimed';
            patch.claimedAt = new Date();
        } else {
            if (user.organizationId) patch.organizationId = user.organizationId;
            patch.claimStatus = 'client_claimed';
        }

        // ① one UPDATE for ALL selected bookings.
        const updated = await db.update(orders)
            .set(patch)
            .where(inArray(orders.orderNumber, codes))
            .returning();

        // ② §10 scenario 2: an agency claiming company orders becomes those
        // clients' agency — insert every missing link in ONE statement.
        if (isAgency && user.organizationId) {
            const clientOrgIds = [...new Set(
                updated.map((o) => o.organizationId).filter(Boolean).filter((id) => id !== user.organizationId),
            )];
            if (clientOrgIds.length > 0) {
                await db.insert(clientAgencyLinks)
                    .values(clientOrgIds.map((clientOrgId) => ({
                        clientOrgId, agencyOrgId: user.organizationId, status: 'active', createdBy: user.id,
                    })))
                    .onConflictDoNothing();
            }
            await priceUnpricedRows(updated, user.organizationId).catch((e) => console.warn('[pricing] claim pricing failed:', e.message));
        }

        // Per-code summary for the toast (rows updated, grouped by code).
        const byCode = new Map();
        for (const o of updated) byCode.set(o.orderNumber, (byCode.get(o.orderNumber) || 0) + 1);
        const results = codes.map((code) => ({ orderNumber: code, claimed: byCode.get(code) || 0 }));
        return {
            bookings: results.filter((r) => r.claimed > 0).length,
            vehicles: updated.length,
            results,
        };
    },

    // Stage 2 — release a claimed booking back to the open pool.
    async releaseByOrderNumber(orderNumber) {
        if (!orderNumber) return [];
        return db.update(orders)
            .set({ claimedByUserId: null, claimedByAgencyId: null, claimStatus: 'unclaimed', claimedAt: null, claimReminderCount: 0, lastClaimReminderAt: null, updatedAt: new Date() })
            .where(eq(orders.orderNumber, orderNumber))
            .returning();
    },

    // Stage 2 — decide the INITIAL ownership of a brand-new booking, per the
    // three ownership rules:
    //   Rule 3 — an AGENCY creator (agency admin / superadmin acting as one)
    //            owns the order immediately → 'agency_claimed' to their org.
    //   Rule 1 — a CLIENT-created order whose company is served by exactly ONE
    //            agency is auto-claimed by that agency.
    //   Rule 2 — a CLIENT-created order whose company has 0 or >1 agencies (or
    //            an anonymous/private order) is left 'unclaimed' so it surfaces
    //            in Klaim Order and all eligible agencies are notified.
    // An affiliate link (`affiliateAgency`, pre-resolved from ?ref=<code>) wins
    // over everything — the order belongs to that agent's agency.
    // Returns a partial { claimStatus, claimedByAgencyId?, claimedByUserId? }
    // to spread into create().
    async resolveInitialClaim({ user = null, targetOrgId = null, affiliateAgency = null }) {
        if (affiliateAgency?.organizationId) {
            return {
                claimedByAgencyId: affiliateAgency.organizationId,
                claimedByUserId: affiliateAgency.id || null,
                claimStatus: 'agency_claimed',
                claimedAt: new Date(),
            };
        }

        // Rule 3 — the vendor (agency / superadmin) creating the order OWNS it
        // immediately, so it is never open for claiming.
        // The superadmin has no organisation of its own, so it acts for the
        // agency that serves the client (see ownerAgencyFor). Before this fix
        // its orders were stored with NO owning agency and vanished from every
        // agency's Rekap (owner test 2026-10-28: C081…C134 missing for DSR Rent Car).
        const actsAsAgency = !!user && (user.accountType === 'agency' || user.role === 'superadmin');
        if (actsAsAgency) {
            const agencyId = user.organizationId || (await this.ownerAgencyFor(targetOrgId));
            return {
                claimedByAgencyId: agencyId || null,
                claimedByUserId: user.id,
                claimStatus: 'agency_claimed',
                claimedAt: new Date(),
            };
        }

        // Rules 1 & 2 — client-created (or anonymous company) order: route by
        // how many agencies actively serve the order's client org.
        if (targetOrgId) {
            const links = await db
                .select({ agencyOrgId: clientAgencyLinks.agencyOrgId })
                .from(clientAgencyLinks)
                .where(and(
                    eq(clientAgencyLinks.clientOrgId, targetOrgId),
                    eq(clientAgencyLinks.status, 'active'),
                ));
            if (links.length === 1) {
                return {
                    claimedByAgencyId: links[0].agencyOrgId,
                    claimedByUserId: null,
                    claimStatus: 'agency_claimed',
                claimedAt: new Date(),
                };
            }
        }

        // Rule 2 (and scenario 1/2): leave open for claiming.
        return { claimStatus: 'unclaimed' };
    },

    // Agency that owns an order the superadmin enters for a client org:
    // its single active linked agency → its parent agency → the default agency.
    async ownerAgencyFor(clientOrgId = null) {
        if (clientOrgId) {
            const links = await db.select({ agencyOrgId: clientAgencyLinks.agencyOrgId }).from(clientAgencyLinks)
                .where(and(eq(clientAgencyLinks.clientOrgId, clientOrgId), eq(clientAgencyLinks.status, 'active')));
            if (links.length === 1) return links[0].agencyOrgId;
            const [o] = await db.select({ id: organizations.id, parentAgencyId: organizations.parentAgencyId })
                .from(organizations).where(eq(organizations.id, clientOrgId)).limit(1);
            if (o && o.parentAgencyId == null) return o.id;       // the org is itself an agency
            if (o?.parentAgencyId) return o.parentAgencyId;
        }
        return resolveDefaultAgencyId();
    },

    // Stage 2 — bookings the caller may claim. §10 visibility:
    //   • private/anonymous (no org)         → open to ALL agencies (scenario 1)
    //   • company whose client has no agency → open to ALL agencies (scenario 2)
    //   • company linked to this agency      → this agency (scenario 3)
    // CLAIMING IS AN AGENCY ACTION. Clients never claim — their orders are
    // handled by the serving agency — so a client's Klaim list is always EMPTY
    // (including their own submissions). Superadmin sees all unclaimed.
    async findClaimable(scopeUser = null) {
        const isAgencyOrSuper = scopeUser?.role === 'superadmin'
            || scopeUser?.accountType === 'agency';
        if (!isAgencyOrSuper) return [];

        const unclaimed = or(eq(orders.claimStatus, 'unclaimed'), isNull(orders.claimStatus));
        let where;

        if (scopeUser?.role === 'superadmin') {
            where = unclaimed;
        } else { // agency
            const myOrg = scopeUser.organizationId;
            where = and(
                unclaimed,
                eq(orders.isDemo, false),
                or(
                    isNull(orders.organizationId), // scenario 1
                    ...(myOrg ? [eq(orders.organizationId, myOrg)] : []),
                    ...(myOrg ? [sql`${orders.organizationId} IN (SELECT client_org_id FROM client_agency_links WHERE agency_org_id = ${myOrg} AND status = 'active')`] : []), // scenario 3
                    sql`(${orders.organizationId} IS NOT NULL AND ${orders.organizationId} NOT IN (SELECT client_org_id FROM client_agency_links WHERE status = 'active'))`, // scenario 2
                ),
            );
        }

        const rows = await db
            .select({ order: orders, car: cars, customer: customers, driver: drivers })
            .from(orders)
            .leftJoin(cars, eq(orders.carId, cars.id))
            .leftJoin(customers, eq(orders.customerId, customers.id))
            .leftJoin(drivers, eq(orders.driverId, drivers.id))
            .where(where)
            .orderBy(desc(orders.createdAt));
        // Before claiming, agencies get NO contact details (security check
        // 2026-11-05): otherwise an agency could read the phone/email from the
        // open list and approach the customer outside the platform. Company,
        // route, dates and price stay visible to decide on claiming.
        const mask = scopeUser?.role !== 'superadmin';
        return rows.map(r => {
            const o = { ...r.order, car: r.car, customer: r.customer, driver: decryptDriver(r.driver) };
            return mask ? maskClaimable(o) : o;
        });
    },

    // Autosuggest source for the booking form's "Nama Perusahaan" field.
    // Each user sees the distinct companies THEY have previously booked for
    // (orders.created_by = them); a superadmin sees every company on record.
    // The field itself stays free-text — this only powers the recommendations.
    async companySuggestions(user) {
        const conds = [
            sql`${customers.companyName} IS NOT NULL`,
            sql`TRIM(${customers.companyName}) <> ''`,
        ];
        if (user?.role !== 'superadmin' && user?.id) {
            conds.push(eq(orders.createdBy, user.id));
        }
        const rows = await db
            .selectDistinct({ name: customers.companyName })
            .from(orders)
            .leftJoin(customers, eq(orders.customerId, customers.id))
            .where(and(...conds))
            .orderBy(asc(customers.companyName));
        return rows.map((r) => r.name).filter(Boolean);
    },

    async markWhatsAppSent(id) {
        const result = await db.update(orders).set({ whatsappSent: true, updatedAt: new Date() }).where(eq(orders.id, id)).returning();
        return result[0];
    },

    async getByDateRange(startDate, endDate) {
        return db.select({
            order: orders,
            car: cars,
            customer: customers,
            driver: drivers,
        })
        .from(orders)
        .leftJoin(cars, eq(orders.carId, cars.id))
        .leftJoin(customers, eq(orders.customerId, customers.id))
        .leftJoin(drivers, eq(orders.driverId, drivers.id))
        .where(
            and(
                gte(orders.pickupDate, new Date(startDate)),
                lte(orders.returnDate, new Date(endDate))
            )
        )
        .orderBy(asc(orders.pickupDate));
    },

    async getStats(scopeUser = null) {
        // Build a scoped base query using Drizzle so the aggregation respects
        // company-level isolation — no raw SQL interpolation needed.
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: orders.organizationId,
            isDemo: orders.isDemo,
            createdBy: orders.createdBy,
            claimedByAgencyId: orders.claimedByAgencyId,
        });

        let baseQuery = db.select({ count: sql`1` }).from(orders);
        const whereClause = scopeConds.length > 0 ? and(...scopeConds) : undefined;

        const [total, pending, confirmed, active, completed, cancelled, thisMonth, revenueRows] =
            await Promise.all([
                db.select({ n: sql`count(*)::int` }).from(orders).where(whereClause).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(orders.status, 'pending'))).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(orders.status, 'confirmed'))).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(orders.status, 'active'))).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(orders.status, 'completed'))).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(orders.status, 'cancelled'))).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), sql`date_trunc('month', ${orders.createdAt}) = date_trunc('month', NOW())`)).then(r => Number(r[0]?.n || 0)),
                db.select({ rev: sql`coalesce(sum(${orders.totalPrice})::float, 0)` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), sql`${orders.status} <> 'cancelled'`)),
            ]);

        return {
            total,
            pending,
            confirmed,
            active,
            completed,
            cancelled,
            thisMonth,
            revenue: Number(revenueRows[0]?.rev || 0),
        };
    },
};
