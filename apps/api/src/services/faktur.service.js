// ─── Faktur Pajak (owner 2026-11-09) ────────────────────────────────────────
// One faktur = one or more invoices of the SAME buyer in the SAME masa pajak
// (bulan Tgl Kirim). PPN of a faktur gabungan is computed once on Σ DPP and
// allocated back to the invoices (tax-core.js allocatePpn), so
//   Σ invoice totals (DPP + PPN) = faktur DPP + PPN.
// Status: draft → terbit (NSFP + tanggal from Coretax) → diganti (a pengganti
// replaces it) / batal. Invoices in a TERBIT faktur are locked (amounts, sent
// date, cancel) until a pengganti is made. The faktur PDF from Coretax can be
// uploaded (private area 'faktur', encrypted).
import { db } from '../db/index.js';
import { fakturPajak, invoices, organizations, orders } from '../db/schema.js';
import { and, eq, inArray, isNull, isNotNull, desc, asc } from 'drizzle-orm';
import { fakturBlockers, taxProfileOf } from './tax-core.js';
import { invoiceService, reallocateFaktur } from './invoice.service.js';
import { decryptField } from './crypto.service.js';
import { removePrivateRef } from './private-files.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });
const masaOf = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7) : null);
const n = (v) => Number(v || 0);

async function agencyOf(user) {
    const id = await invoiceService.agencyIdFor(user);
    if (!id) throw httpError(400, 'Agency tidak ditemukan.');
    return id;
}

async function loadOwned(user, id) {
    const [f] = await db.select().from(fakturPajak).where(eq(fakturPajak.id, Number(id))).limit(1);
    if (!f) throw httpError(404, 'Faktur tidak ditemukan.');
    if (user.role !== 'superadmin' && f.organizationId !== await agencyOf(user)) throw httpError(404, 'Faktur tidak ditemukan.');
    return f;
}

const invoiceView = (i) => ({
    id: i.id, invoiceNumber: i.invoiceNumber, companyName: i.companyName, clientOrgId: i.clientOrgId,
    sentDate: i.sentDate, masa: masaOf(i.sentDate), letterNumber: i.letterNumber,
    subtotal: n(i.subtotal), discount: n(i.discountAmount), dpp: n(i.dpp), dppOther: n(i.dppOther), ppn: n(i.ppnAmount),
    pphMode: i.pphMode, pph: n(i.pphAmount), total: n(i.totalAmount), fakturId: i.fakturId,
    ppnEnabled: !!taxProfileOf(i.taxProfile).ppn.enabled, ppnRate: taxProfileOf(i.taxProfile).ppn.rate, ppnBase: taxProfileOf(i.taxProfile).ppn.base,
    isCancelled: i.isCancelled,
});

async function withInvoices(list) {
    if (!list.length) return [];
    const inv = await db.select().from(invoices).where(and(inArray(invoices.fakturId, list.map((f) => f.id)), eq(invoices.isCancelled, false)))
        .orderBy(asc(invoices.sentDate), asc(invoices.id));
    return list.map(({ fileRef, ...f }) => ({
        ...f, dpp: n(f.dpp), dppOther: n(f.dppOther), ppnAmount: n(f.ppnAmount), hasFile: !!fileRef,
        invoices: inv.filter((i) => i.fakturId === f.id).map(invoiceView),
    }));
}

async function buyerOf(clientOrgId, fallbackName) {
    if (!clientOrgId) return { buyerName: fallbackName || null, buyerNpwp: null, buyerAddress: null };
    const [o] = await db.select({ name: organizations.name, npwp: organizations.npwp, address: organizations.address })
        .from(organizations).where(eq(organizations.id, clientOrgId)).limit(1);
    let npwp = null;
    try { npwp = o?.npwp ? decryptField(o.npwp) : null; } catch { npwp = null; }
    return { buyerName: o?.name || fallbackName || null, buyerNpwp: npwp, buyerAddress: o?.address || null };
}

export const fakturService = {
    async list(user, { masa, status } = {}) {
        const conds = [];
        if (user.role !== 'superadmin') conds.push(eq(fakturPajak.organizationId, await agencyOf(user)));
        if (masa) conds.push(eq(fakturPajak.masa, String(masa).slice(0, 7)));
        if (status) conds.push(eq(fakturPajak.status, String(status)));
        const list = await db.select().from(fakturPajak).where(conds.length ? and(...conds) : undefined)
            .orderBy(desc(fakturPajak.masa), desc(fakturPajak.id)).limit(500);
        return { data: await withInvoices(list), total: list.length, page: 1 };
    },

    async get(user, id) {
        const [f] = await withInvoices([await loadOwned(user, id)]);
        return f;
    },

    /** Sent invoices with PPN that are not in a faktur yet (optionally one masa / buyer). */
    async candidates(user, { masa, clientOrgId } = {}) {
        const conds = [eq(invoices.isCancelled, false), isNull(invoices.fakturId), isNotNull(invoices.sentDate)];
        if (user.role !== 'superadmin') conds.push(eq(invoices.organizationId, await agencyOf(user)));
        if (clientOrgId) conds.push(eq(invoices.clientOrgId, Number(clientOrgId)));
        const rows = (await db.select().from(invoices).where(and(...conds)).orderBy(desc(invoices.sentDate)).limit(1000)).map(invoiceView);
        return rows.filter((i) => (!masa || i.masa === masa));
    },

    async create(user, { invoiceIds = [], nsfp = null, fakturDate = null, notes = null } = {}) {
        const agencyId = user.role === 'superadmin' ? null : await agencyOf(user);
        const ids = [...new Set(invoiceIds.map(Number).filter(Boolean))];
        const rows = ids.length ? await db.select().from(invoices).where(inArray(invoices.id, ids)) : [];
        if (rows.length !== ids.length || (agencyId && rows.some((r) => r.organizationId !== agencyId))) throw httpError(404, 'Invoice tidak ditemukan.');
        const views = rows.map(invoiceView);
        const blockers = fakturBlockers(views);
        const profiles = new Set(rows.map((r) => { const p = taxProfileOf(r.taxProfile).ppn; return `${p.rate}|${p.base}`; }));
        if (profiles.size > 1) blockers.push('Tarif / dasar PPN invoice berbeda — tidak bisa digabung.');
        if (new Set(rows.map((r) => r.organizationId)).size > 1) blockers.push('Invoice dari agency berbeda.');
        if (blockers.length) throw httpError(400, blockers.join(' '));
        const first = rows[0];
        const buyer = await buyerOf(first.clientOrgId, first.companyName);
        const id = await db.transaction(async (tx) => {
            const [f] = await tx.insert(fakturPajak).values({
                organizationId: first.organizationId, clientOrgId: first.clientOrgId, ...buyer,
                masa: views[0].masa, kind: rows.length > 1 ? 'gabungan' : 'tunggal',
                nsfp: nsfp ? String(nsfp).trim().slice(0, 40) : null, fakturDate: fakturDate || null,
                taxProfile: taxProfileOf(first.taxProfile), notes: notes ? String(notes).slice(0, 1000) : null,
                createdBy: user?.id || null,
            }).returning();
            await tx.update(invoices).set({ fakturId: f.id, updatedAt: new Date() }).where(inArray(invoices.id, ids));
            await reallocateFaktur(tx, f.id);
            return f.id;
        });
        return this.get(user, id);
    },

    /** Edit header; add/remove invoices while draft; status terbit / batal. */
    async update(user, id, body = {}) {
        const f = await loadOwned(user, id);
        const patch = { updatedAt: new Date() };
        for (const k of ['buyerName', 'buyerNpwp', 'buyerAddress', 'notes']) if (body[k] !== undefined) patch[k] = body[k] ? String(body[k]).slice(0, k === 'notes' || k === 'buyerAddress' ? 1000 : 255) : null;
        if (body.nsfp !== undefined) patch.nsfp = body.nsfp ? String(body.nsfp).trim().slice(0, 40) : null;
        if (body.fakturDate !== undefined) patch.fakturDate = body.fakturDate || null;
        const locked = f.status !== 'draft';
        if (locked && (body.addInvoiceIds?.length || body.removeInvoiceIds?.length)) throw httpError(409, 'Faktur sudah terbit — buat faktur pengganti untuk mengubah isinya.');
        if (locked && f.status !== 'terbit' && Object.keys(patch).length > 1) throw httpError(409, 'Faktur ini sudah diganti / batal.');

        await db.transaction(async (tx) => {
            if (body.removeInvoiceIds?.length) {
                const rm = body.removeInvoiceIds.map(Number);
                const gone = await tx.update(invoices).set({ fakturId: null, updatedAt: new Date() })
                    .where(and(eq(invoices.fakturId, f.id), inArray(invoices.id, rm))).returning({ id: invoices.id });
                for (const g of gone) await invoiceService.recomputeIn(tx, g.id);   // back to its own PPN
            }
            if (body.addInvoiceIds?.length) {
                const add = await tx.select().from(invoices).where(inArray(invoices.id, body.addInvoiceIds.map(Number)));
                const current = await tx.select().from(invoices).where(and(eq(invoices.fakturId, f.id), eq(invoices.isCancelled, false)));
                const all = [...current, ...add].map(invoiceView);
                const blockers = fakturBlockers(add.map(invoiceView));
                if (new Set(all.map((i) => String(i.clientOrgId ?? i.companyName))).size > 1) blockers.push('Pembeli berbeda.');
                if (all.some((i) => i.masa !== f.masa)) blockers.push(`Masa pajak harus ${f.masa}.`);
                if (add.some((i) => i.organizationId !== f.organizationId)) blockers.push('Invoice dari agency lain.');
                if (blockers.length) throw httpError(400, blockers.join(' '));
                await tx.update(invoices).set({ fakturId: f.id, updatedAt: new Date() }).where(inArray(invoices.id, add.map((i) => i.id)));
            }
            const c = (await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.fakturId, f.id), eq(invoices.isCancelled, false)))).length;
            if (!c && f.status === 'draft') throw httpError(400, 'Faktur harus berisi minimal satu invoice.');
            patch.kind = c > 1 ? 'gabungan' : 'tunggal';
            if (body.status === 'terbit') {
                const nsfp = patch.nsfp !== undefined ? patch.nsfp : f.nsfp;
                const date = patch.fakturDate !== undefined ? patch.fakturDate : f.fakturDate;
                if (f.status !== 'draft') throw httpError(409, 'Hanya faktur draft yang bisa diterbitkan.');
                if (!nsfp || !date) throw httpError(400, 'Isi Nomor Seri Faktur (NSFP) dan tanggal faktur dari Coretax.');
                patch.status = 'terbit';
            }
            await tx.update(fakturPajak).set(patch).where(eq(fakturPajak.id, f.id));
            await reallocateFaktur(tx, f.id);
        });
        return this.get(user, f.id);
    },

    /** Batal: invoices are released (back to their own PPN). */
    async cancel(user, id, { reason } = {}) {
        const f = await loadOwned(user, id);
        if (['batal', 'diganti'].includes(f.status)) throw httpError(409, 'Faktur sudah batal / diganti.');
        await db.transaction(async (tx) => {
            await tx.update(fakturPajak).set({ status: 'batal', notes: [f.notes, reason ? `Batal: ${reason}` : null].filter(Boolean).join('\n').slice(0, 1000) || null, updatedAt: new Date() })
                .where(eq(fakturPajak.id, f.id));
            const rel = await tx.update(invoices).set({ fakturId: null, updatedAt: new Date() }).where(eq(invoices.fakturId, f.id)).returning({ id: invoices.id });
            for (const r of rel) await invoiceService.recomputeIn(tx, r.id);
        });
        return this.get(user, f.id);
    },

    /** Pengganti: the issued faktur becomes 'diganti'; its invoices move to a new draft that can be edited. */
    async replace(user, id) {
        const f = await loadOwned(user, id);
        if (f.status !== 'terbit') throw httpError(409, 'Hanya faktur terbit yang bisa diganti.');
        const newId = await db.transaction(async (tx) => {
            const { id: _i, createdAt: _c, updatedAt: _u, fileRef: _f, fileName: _n, nsfp: _s, fakturDate: _d, status: _st, ...keep } = f;
            const [nf] = await tx.insert(fakturPajak).values({ ...keep, status: 'draft', replacesId: f.id, createdBy: user?.id || null }).returning();
            await tx.update(fakturPajak).set({ status: 'diganti', updatedAt: new Date() }).where(eq(fakturPajak.id, f.id));
            await tx.update(invoices).set({ fakturId: nf.id, updatedAt: new Date() }).where(eq(invoices.fakturId, f.id));
            await reallocateFaktur(tx, nf.id);
            return nf.id;
        });
        return this.get(user, newId);
    },

    async setFile(user, id, file) {
        const f = await loadOwned(user, id);
        if (!file) throw httpError(400, 'Pilih file faktur (PDF).');
        if (f.fileRef) removePrivateRef(f.fileRef, 'faktur');
        await db.update(fakturPajak).set({ fileRef: file.ref, fileName: String(file.name || 'faktur.pdf').slice(0, 200), updatedAt: new Date() }).where(eq(fakturPajak.id, f.id));
        return this.get(user, f.id);
    },

    async fileOf(user, id) {
        const f = await loadOwned(user, id);
        if (!f.fileRef) throw httpError(404, 'Belum ada file faktur.');
        return { ref: f.fileRef, name: f.fileName || `faktur-${f.nsfp || f.id}.pdf` };
    },

    /** Lines of a faktur (one per order row) — for the printed recap / CSV. */
    async lines(user, id) {
        const f = await this.get(user, id);
        const ids = f.invoices.map((i) => i.id);
        const rows = ids.length ? await db.select({ invoiceId: orders.invoiceId, orderNumber: orders.orderNumber, totalPrice: orders.totalPrice, pickupDate: orders.pickupDate, returnDate: orders.returnDate })
            .from(orders).where(inArray(orders.invoiceId, ids)).orderBy(asc(orders.orderNumber), asc(orders.id)) : [];
        return { faktur: f, rows };
    },

    /** CSV (generic columns; aligned to the owner's Coretax sample later — Review Register X-25). */
    async csv(user, { masa } = {}) {
        const { data } = await this.list(user, { masa });
        const esc = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const head = ['Masa', 'Status', 'Jenis', 'NSFP', 'Tanggal Faktur', 'Pembeli', 'NPWP Pembeli', 'No. Invoice', 'DPP', 'DPP Nilai Lain', 'PPN'];
        const lines = [head.join(';')];
        for (const f of data) {
            lines.push([f.masa, f.status, f.kind, f.nsfp, f.fakturDate, f.buyerName, f.buyerNpwp, f.invoices.map((i) => i.invoiceNumber).join(', '), f.dpp, f.dppOther, f.ppnAmount].map(esc).join(';'));
        }
        return lines.join('\n');
    },
};
