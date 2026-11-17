// ─── Monthly client report ──────────────────────────────────────────────────
// For one client company and one month: spend, bookings, units, rental days,
// km driven (driver-app trips), per cost centre / vehicle type / requester,
// invoices issued & outstanding, active contracts.
//   • GET /api/corporate/report?period=YYYY-MM  → JSON (printable page → PDF)
//   • Monthly job (1st of the month, 07:00 WIB): emails the previous month to
//     the company's admins + users with corporate.view, with a CSV attachment.
//     Per company switch: corporate_settings.monthlyReport (default on).
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import { orders, cars, organizations, invoices, driverTrips, leaseContracts, user as userTable } from '../db/schema.js';
import { and, eq, sql, inArray, gte, lte } from 'drizzle-orm';
import { periodRange } from './contracts-core.js';
import { requestedCategoryFromNotes } from './pricing.service.js';
import { deriveInvoiceStatus } from './invoice.service.js';
import { getAccess, hasPerm } from './access.service.js';
import { sendEmail } from './email.service.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const periodLabel = (p) => `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;

export async function buildClientReport(clientOrgId, period) {
    const { from, to } = periodRange(period);
    const start = new Date(`${from}T00:00:00+07:00`), end = new Date(`${to}T23:59:59+07:00`);
    const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, clientOrgId)).limit(1);
    const rows = await db.select({
        id: orders.id, orderNumber: orders.orderNumber, pickupDate: orders.pickupDate, returnDate: orders.returnDate, totalDays: orders.totalDays,
        totalPrice: orders.totalPrice, costCenter: orders.costCenter, notes: orders.notes, destination: orders.destination, package: orders.package,
        status: orders.status, carType: cars.type, carName: cars.name, plate: cars.licensePlate, requester: userTable.name,
    }).from(orders).leftJoin(cars, eq(cars.id, orders.carId)).leftJoin(userTable, eq(userTable.id, orders.createdBy))
        .where(and(
            eq(orders.organizationId, clientOrgId), sql`${orders.status} <> 'cancelled'`,
            sql`(${orders.clientApprovalStatus} IS NULL OR ${orders.clientApprovalStatus} = 'approved')`,
            gte(orders.pickupDate, start), lte(orders.pickupDate, end),
        ));
    const ids = rows.map((r) => r.id);
    const trips = ids.length ? await db.select({ orderId: driverTrips.orderId, s: driverTrips.startOdometer, e: driverTrips.endOdometer }).from(driverTrips).where(inArray(driverTrips.orderId, ids)) : [];
    const kmBy = new Map(trips.filter((t) => t.s != null && t.e != null).map((t) => [t.orderId, Math.max(0, t.e - t.s)]));
    const group = (keyFn) => {
        const m = new Map();
        for (const r of rows) {
            const k = keyFn(r) || '-';
            const c = m.get(k) || { key: k, amount: 0, vehicles: 0, days: 0 };
            c.amount += Number(r.totalPrice) || 0; c.vehicles += 1; c.days += Number(r.totalDays) || 0;
            m.set(k, c);
        }
        return [...m.values()].sort((a, b) => b.amount - a.amount);
    };
    const invs = await db.select().from(invoices).where(and(eq(invoices.clientOrgId, clientOrgId), eq(invoices.isCancelled, false)));
    const issued = invs.filter((i) => i.sentDate && new Date(i.sentDate) >= start && new Date(i.sentDate) <= end);
    const outstanding = invs.filter((i) => i.sentDate && !i.paidDate).map((i) => ({ ...i, status: deriveInvoiceStatus(i), remaining: Math.max(0, Number(i.totalAmount || 0) - Number(i.paidAmount || 0)) }))
        .filter((i) => i.remaining > 0);
    const contracts = await db.select().from(leaseContracts).where(and(eq(leaseContracts.clientOrgId, clientOrgId), eq(leaseContracts.status, 'active')));
    return {
        company: org?.name || '-', period, label: periodLabel(period),
        totals: {
            spend: rows.reduce((t, r) => t + (Number(r.totalPrice) || 0), 0),
            bookings: new Set(rows.map((r) => r.orderNumber)).size, vehicles: rows.length,
            days: rows.reduce((t, r) => t + (Number(r.totalDays) || 0), 0),
            km: [...kmBy.values()].reduce((t, k) => t + k, 0),
            invoicedThisMonth: issued.reduce((t, i) => t + Number(i.totalAmount || 0), 0),
            outstanding: outstanding.reduce((t, i) => t + i.remaining, 0),
        },
        byCostCenter: group((r) => r.costCenter || 'Tanpa pusat biaya'),
        byCategory: group((r) => r.carType || requestedCategoryFromNotes(r.notes) || 'Belum ditentukan'),
        byRequester: group((r) => r.requester || 'Admin agency'),
        outstandingInvoices: outstanding.map((i) => ({ invoiceNumber: i.invoiceNumber, dueDate: i.dueDate, remaining: i.remaining, status: i.status })),
        contracts: contracts.map((c) => ({ contractNumber: c.contractNumber, title: c.title, endDate: c.endDate })),
        orders: rows.map((r) => ({
            orderNumber: r.orderNumber, pickupDate: r.pickupDate, returnDate: r.returnDate, days: r.totalDays,
            unit: [r.carName, r.plate].filter(Boolean).join(' · ') || requestedCategoryFromNotes(r.notes) || '-',
            package: r.package, destination: r.destination, costCenter: r.costCenter, requester: r.requester, km: kmBy.get(r.id) ?? null,
            amount: Number(r.totalPrice) || 0, status: r.status,
        })),
    };
}

export function reportCsv(rep) {
    const head = ['Kode', 'Tgl Mulai', 'Tgl Selesai', 'Hari', 'Unit', 'Paket', 'Tujuan', 'Pusat Biaya', 'Pemesan', 'Km', 'Jumlah', 'Status'];
    const cell = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const d = (x) => (x ? new Date(x).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) : '');
    const lines = rep.orders.map((o) => [o.orderNumber, d(o.pickupDate), d(o.returnDate), o.days, o.unit, o.package, o.destination, o.costCenter, o.requester, o.km, o.amount, o.status].map(cell).join(','));
    return '﻿' + [head.join(','), ...lines].join('\n');
}

export function reportHtml(rep) {
    const t = rep.totals;
    const rows = (list) => list.slice(0, 10).map((g) => `<tr><td style="padding:4px 8px">${esc(g.key)}</td><td style="padding:4px 8px;text-align:right">${g.vehicles}</td><td style="padding:4px 8px;text-align:right">${rp(g.amount)}</td></tr>`).join('');
    const table = (title, list) => `<h3 style="font-size:14px;margin:18px 0 6px">${title}</h3><table style="border-collapse:collapse;width:100%;font-size:13px">${rows(list) || '<tr><td>-</td></tr>'}</table>`;
    return `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:24px">
<table style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px"><tr><td>
<h1 style="font-size:20px;margin:0">Laporan Bulanan — ${esc(rep.company)}</h1>
<p style="color:#64748b;margin:4px 0 16px">${esc(rep.label)}</p>
<table style="width:100%;font-size:13px"><tr>
<td><b>${rp(t.spend)}</b><br><span style="color:#64748b">Total sewa</span></td>
<td><b>${t.bookings}</b><br><span style="color:#64748b">Pemesanan</span></td>
<td><b>${t.vehicles}</b><br><span style="color:#64748b">Unit</span></td>
<td><b>${t.km.toLocaleString('id-ID')} km</b><br><span style="color:#64748b">Jarak (aplikasi driver)</span></td></tr></table>
<p style="font-size:13px">Invoice terbit bulan ini: <b>${rp(t.invoicedThisMonth)}</b> · Belum lunas (semua): <b>${rp(t.outstanding)}</b></p>
${table('Per pusat biaya', rep.byCostCenter)}${table('Per jenis kendaraan', rep.byCategory)}${table('Per pemesan', rep.byRequester)}
<p style="color:#94a3b8;font-size:12px;margin-top:20px">Rincian per order terlampir (CSV). Laporan lengkap & cetak PDF: Portal Perusahaan → Laporan Bulanan.</p>
</td></tr></table></body></html>`;
}

/** 1st of month: previous month to every company with activity. */
export async function runMonthlyReports(now = new Date()) {
    const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const prev = new Date(wib.getFullYear(), wib.getMonth() - 1, 1);
    const period = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const { from, to } = periodRange(period);
    const active = await db.selectDistinct({ id: orders.organizationId }).from(orders).where(and(
        sql`${orders.organizationId} IS NOT NULL`, gte(orders.pickupDate, new Date(`${from}T00:00:00+07:00`)), lte(orders.pickupDate, new Date(`${to}T23:59:59+07:00`)),
    ));
    let sent = 0;
    for (const { id } of active) {
        const [org] = await db.select({ parent: organizations.parentAgencyId, s: organizations.corporateSettings }).from(organizations).where(eq(organizations.id, id)).limit(1);
        if (!org || org.s?.monthlyReport === false) continue;
        const members = await db.select({ id: userTable.id, email: userTable.email, accountType: userTable.accountType }).from(userTable)
            .where(and(eq(userTable.organizationId, id), eq(userTable.isActive, true)));
        const recipients = [];
        for (const m of members) if (m.accountType === 'client' && m.email && hasPerm(await getAccess(m.id), 'corporate.view')) recipients.push(m.email);
        if (!recipients.length) continue;
        const rep = await buildClientReport(id, period);
        if (!rep.orders.length) continue;
        for (const to of recipients.slice(0, 20)) {
            await sendEmail({
                to, subject: `Laporan Bulanan ${rep.label} — ${rep.company}`, html: reportHtml(rep),
                text: `Laporan ${rep.label}: total ${rp(rep.totals.spend)}, ${rep.totals.bookings} pemesanan.`,
                attachments: [{ filename: `laporan-${period}.csv`, content: reportCsv(rep), contentType: 'text/csv; charset=utf-8' }],
            }).catch((e) => console.warn('[report] email failed:', e.message));
        }
        sent++;
    }
    return { period, companies: sent };
}
