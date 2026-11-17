// ─── Invoicing lembur & operasional forms by code (L### / R###) ─────────────
// Owner 2026-11-05: every form has its own code and is approved by BOTH sides;
// Dokumen → Invoice pulls the approved codes. To reuse the whole invoice
// pipeline (Tgl Kirim, due date, payments, Xendit, Books auto-posting), each
// form becomes one order row whose booking code IS the form code (status
// completed, package Lembur / Operasional), then invoiceService.issueForOrders
// creates (or extends — mode A: same number as the M invoice) the invoice.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import { opsEntries, leaseContracts, organizations, cars, drivers, orders } from '../db/schema.js';
import { and, eq, inArray, isNull, isNotNull, gt, asc } from 'drizzle-orm';
import { customerService } from './customer.service.js';
import { orderService } from './order.service.js';
import { invoiceService } from './invoice.service.js';
import { TYPE_LABEL } from './ops.service.js';
import * as O from './ops-core.js';

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const CODE = /^[LRTO]\d{3,}$/;   // L lembur · T perjalanan dinas · O operasional · R older operasional

export function parseCodes(raw) {
    const list = [...new Set(String(Array.isArray(raw) ? raw.join(',') : raw || '').toUpperCase().split(/[\s,;]+/).filter(Boolean))];
    if (!list.length) throw httpError(400, 'Masukkan kode L/T/O.');
    const bad = list.filter((c) => !CODE.test(c));
    if (bad.length) throw httpError(400, `Kode tidak dikenal: ${bad.join(', ')} (format L001 / T001 / O001).`);
    if (list.length > 100) throw httpError(400, 'Maksimal 100 kode per invoice.');
    return list;
}

function scopeOf(user) {
    if (user.role === 'superadmin') return [];
    if (user.accountType === 'client' || !user.organizationId) throw httpError(403, 'Invoice dibuat oleh agency.');
    return [eq(opsEntries.agencyOrgId, user.organizationId)];
}

const kindLabel = (k) => (k === 'overtime' ? 'Lembur' : k === 'trip' ? 'Perjalanan Dinas' : 'Operasional');

export const opsBillingService = {
    /** Validate codes and return printable lines. */
    async lines(user, rawCodes) {
        const codes = parseCodes(rawCodes);
        const rows = await db.select({
            e: opsEntries, contractNumber: leaseContracts.contractNumber, clientName: organizations.name,
            carName: cars.name, carBrand: cars.brand, plate: cars.licensePlate, driverName: drivers.name,
        }).from(opsEntries)
            .leftJoin(leaseContracts, eq(leaseContracts.id, opsEntries.contractId))
            .leftJoin(organizations, eq(organizations.id, opsEntries.clientOrgId))
            .leftJoin(cars, eq(cars.id, opsEntries.carId))
            .leftJoin(drivers, eq(drivers.id, opsEntries.driverId))
            .where(and(inArray(opsEntries.code, codes), ...scopeOf(user)));
        const found = new Map(rows.map((r) => [r.e.code, r]));
        const missing = codes.filter((c) => !found.has(c));
        if (missing.length) throw httpError(404, `Kode tidak ditemukan: ${missing.join(', ')}.`);
        const problems = [];
        for (const c of codes) {
            const { e } = found.get(c);
            if (e.status === 'billed' || e.invoiceId) problems.push(`${c} sudah ditagih`);
            else if (e.status !== 'approved') problems.push(`${c} belum disetujui kedua pihak`);
            else if (!e.billable) problems.push(`${c} tercatat saja (kontrak tidak menagihkan lembur/operasional)`);
            else if (!(Number(e.amount) > 0)) problems.push(`${c} nominalnya 0`);
        }
        if (problems.length) throw httpError(400, `Tidak bisa ditagih: ${problems.join('; ')}.`);
        const contracts = new Set(codes.map((c) => found.get(c).e.contractId));
        if (contracts.size > 1) throw httpError(400, 'Satu invoice hanya untuk kode dari kontrak yang sama.');
        const first = found.get(codes[0]);
        const lines = codes.map((c) => {
            const r = found.get(c), e = r.e, d = e.detail || {};
            const opsParts = e.type === 'operasional' && d.totals
                ? Object.entries(d.totals).filter(([, v]) => v > 0).map(([k]) => (TYPE_LABEL[k] || k).split(' ')[0]).join(', ') : '';
            const what = e.kind === 'overtime' ? `Lembur ${O.hhmm(e.hours)} jam`
                : e.kind === 'trip' ? `Perjalanan dinas ${d.destinationCity || ''} ${d.calc?.days ? `(${d.calc.days} hari)` : ''}`.trim()
                    : e.type === 'operasional' ? `Operasional (${opsParts})${d.totalKm ? ` · ${d.totalKm} km` : ''}`
                        : `${TYPE_LABEL[e.type] || e.type}${e.note ? ` — ${e.note}` : ''}`;
            return {
                code: c, kind: e.kind, kindLabel: kindLabel(e.kind), entryDate: e.entryDate,
                // Tgl pemakaian on the invoice: SPPD berangkat→kembali; lembur / operasional mulai→selesai.
                returnDate: e.kind === 'trip' ? (d.returnDate || e.entryDate) : (d.endDate || e.entryDate),
                description: what, hours: e.hours == null ? null : Number(e.hours), amount: Number(e.amount),
                unit: r.carName ? `${r.carBrand || ''} ${r.carName}`.trim() : '', plate: r.plate || '', driver: r.driverName || '',
                destination: d.destinationCity || d.location || '',
            };
        });
        return {
            contractId: first.e.contractId, contractNumber: first.contractNumber, clientOrgId: first.e.clientOrgId, clientName: first.clientName,
            agencyOrgId: first.e.agencyOrgId, codes, lines, total: lines.reduce((s, l) => s + l.amount, 0),
        };
    },

    /**
     * Approved, billable forms not yet invoiced — shown in Dokumen next to the
     * daily orders ("Order Menunggu Invoice" + Auto-fill). Owner 2026-11-11:
     * no separate "Kode L / R" button.
     */
    async pending(user) {
        const rows = await db.select({
            e: opsEntries, contractNumber: leaseContracts.contractNumber, clientName: organizations.name,
            carName: cars.name, carBrand: cars.brand, plate: cars.licensePlate, driverName: drivers.name,
        }).from(opsEntries)
            .leftJoin(leaseContracts, eq(leaseContracts.id, opsEntries.contractId))
            .leftJoin(organizations, eq(organizations.id, opsEntries.clientOrgId))
            .leftJoin(cars, eq(cars.id, opsEntries.carId))
            .leftJoin(drivers, eq(drivers.id, opsEntries.driverId))
            .where(and(eq(opsEntries.status, 'approved'), eq(opsEntries.billable, true), isNull(opsEntries.invoiceId),
                isNotNull(opsEntries.code), gt(opsEntries.amount, '0'), ...scopeOf(user)))
            .orderBy(asc(opsEntries.entryDate), asc(opsEntries.code)).limit(500);
        return rows.map((r) => ({
            code: r.e.code, kind: r.e.kind, kindLabel: kindLabel(r.e.kind), contractId: r.e.contractId, contractNumber: r.contractNumber,
            clientOrgId: r.e.clientOrgId, clientName: r.clientName, entryDate: r.e.entryDate, amount: Number(r.e.amount),
            carBrand: r.carBrand, carName: r.carName, plate: r.plate, driverName: r.driverName,
        }));
    },

    /** Create the invoice for approved codes and mark the forms billed. */
    async issue(user, { codes: rawCodes, invoiceNumber, sentDate, letterNumber, discount, taxProfile }) {
        const no = String(invoiceNumber || '').trim();
        if (!no) throw httpError(400, 'No. invoice wajib diisi.');
        const prev = await this.lines(user, rawCodes);
        const [client] = await db.select().from(organizations).where(eq(organizations.id, prev.clientOrgId)).limit(1);
        if (!client) throw httpError(400, 'Perusahaan klien tidak ditemukan.');
        const customer = await customerService.findOrCreate({
            name: client.name, customerType: 'company', companyName: client.name,
            phone: client.phone1 || null, whatsapp: client.phone1 || null, email: client.email || null,
            organizationId: client.id, createdBy: user.id,
        });
        const entries = await db.select().from(opsEntries).where(inArray(opsEntries.code, prev.codes));
        const byCode = new Map(entries.map((e) => [e.code, e]));
        const created = [];
        try {
            for (const l of prev.lines) {
                const e = byCode.get(l.code);
                const o = await orderService.create({
                    orderNumber: l.code, carId: e.carId || null, driverId: e.driverId || null, customerId: customer.id, customerName: client.name,
                    pickupDate: new Date(`${l.entryDate}T00:00:00+07:00`), returnDate: new Date(`${l.returnDate}T23:59:00+07:00`),
                    totalDays: 1, dailyRate: String(l.amount), totalPrice: String(l.amount),
                    status: 'completed', package: `${l.kindLabel} ${prev.contractNumber}`.slice(0, 50),
                    destination: l.destination || null, notes: `${l.code} · ${l.description} · kontrak ${prev.contractNumber}`.slice(0, 500),
                    organizationId: prev.clientOrgId, createdBy: user.id, sourceOrigin: 'ops', contractId: prev.contractId || null,
                    claimedByAgencyId: prev.agencyOrgId, claimedByUserId: user.id, claimStatus: 'agency_claimed', claimedAt: new Date(),
                });
                created.push(o.id);
            }
            const res = await invoiceService.issueForOrders({
                items: created.map((id) => ({ id, invoiceNumber: no })), sentDate: sentDate || null, letterNumber: letterNumber || null,
                user, allowedIds: created,
                discount: discount ?? undefined, taxProfile: taxProfile || undefined,   // same as the printed invoice
            });
            const invoiceId = res?.[0]?.invoiceId || null;
            await db.update(opsEntries).set({ status: 'billed', invoiceId, updatedAt: new Date() }).where(inArray(opsEntries.code, prev.codes));
            return { invoiceNumber: no, invoiceId, codes: prev.codes, total: prev.total, orders: created.length };
        } catch (err) {
            if (created.length) await db.delete(orders).where(inArray(orders.id, created)).catch(() => {});
            throw err;
        }
    },
};

export default opsBillingService;
