// ─── Online payment (Xendit Invoice / payment link) ─────────────────────────
// Flow:  invoice sent → "Buat link pembayaran" (agency) or "Bayar online"
//        (client portal) → Xendit hosted page (VA, QRIS, e-wallet, card) →
//        Xendit webhook → invoiceService.addPayment() → Books auto-posts
//        Dr Kas/Bank (XENDIT_CASH_ACCOUNT_CODE) / Cr Piutang.
//
// Env (apps/api/.env):
//   XENDIT_SECRET_KEY        secret API key (xnd_development_… for sandbox)
//   XENDIT_CALLBACK_TOKEN    "Verification token" from Xendit dashboard → Webhooks
//   XENDIT_AGENCY_IDS        comma list of agency org ids that use this Xendit
//                            account (default: the home agency only). Money goes
//                            to THIS account — never enable it for other agencies.
//   XENDIT_CASH_ACCOUNT_CODE Books account receiving the money (default 1-1200)
//   XENDIT_INVOICE_HOURS     link validity (default 72)
//   XENDIT_MOCK=true         dev only: no Xendit call; "Simulasikan bayar" button
// ─────────────────────────────────────────────────────────────────────────────
import { timingSafeEqual } from 'crypto';
import { db } from '../db/index.js';
import { paymentLinks, invoices } from '../db/schema.js';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { invoiceService } from './invoice.service.js';
import { booksAutoPost } from './books-autopost.service.js';
import { resolveDefaultAgencyId } from './relationship.service.js';

const API = 'https://api.xendit.co';
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

export function xenditConfig() {
    const mock = process.env.XENDIT_MOCK === 'true' && process.env.NODE_ENV !== 'production';
    const key = process.env.XENDIT_SECRET_KEY || '';
    return {
        mock, key,
        enabled: mock || !!key,
        callbackToken: process.env.XENDIT_CALLBACK_TOKEN || '',
        agencyIds: String(process.env.XENDIT_AGENCY_IDS || '').split(',').map((x) => Number(x.trim())).filter(Boolean),
        cashAccountCode: process.env.XENDIT_CASH_ACCOUNT_CODE || '1-1200',
        hours: Math.max(1, Number(process.env.XENDIT_INVOICE_HOURS) || 72),
    };
}

async function enabledFor(agencyId) {
    const c = xenditConfig();
    if (!c.enabled || !agencyId) return false;
    if (c.agencyIds.length) return c.agencyIds.includes(Number(agencyId));
    return Number(agencyId) === Number(await resolveDefaultAgencyId());
}

async function xendit(path, body, method = 'POST') {
    const c = xenditConfig();
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Basic ${Buffer.from(`${c.key}:`).toString('base64')}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(502, `Xendit: ${data.message || data.error_code || res.status}`);
    return data;
}

const view = (l) => l && ({
    id: l.id, invoiceId: l.invoiceId, url: l.url, amount: Number(l.amount), status: l.status,
    expiresAt: l.expiresAt, paidAt: l.paidAt, paidAmount: l.paidAmount == null ? null : Number(l.paidAmount),
    channel: l.channel, mock: !l.providerId && l.status === 'pending' ? xenditConfig().mock : false, createdAt: l.createdAt,
});

export const paymentService = {
    async status(agencyId) {
        const c = xenditConfig();
        return { enabled: await enabledFor(agencyId), mock: c.mock, provider: 'xendit' };
    },

    async listForInvoice(invoiceId) {
        const rows = await db.select().from(paymentLinks).where(eq(paymentLinks.invoiceId, Number(invoiceId))).orderBy(desc(paymentLinks.id)).limit(20);
        return rows.map(view);
    },

    /** Active (pending, not expired) link of an invoice, or null. */
    async activeLink(invoiceId) {
        const [l] = await db.select().from(paymentLinks)
            .where(and(eq(paymentLinks.invoiceId, Number(invoiceId)), eq(paymentLinks.status, 'pending')))
            .orderBy(desc(paymentLinks.id)).limit(1);
        if (!l || (l.expiresAt && new Date(l.expiresAt) < new Date())) return null;
        return view(l);
    },

    async createLink(invoiceId, { user = null, payerEmail = null } = {}) {
        const inv = await invoiceService.getById(invoiceId);
        if (!inv) throw httpError(404, 'Invoice tidak ditemukan.');
        if (!(await enabledFor(inv.organizationId))) throw httpError(400, 'Pembayaran online belum aktif untuk agency ini.');
        if (inv.isCancelled) throw httpError(400, 'Invoice sudah dibatalkan.');
        if (!inv.sentDate) throw httpError(400, 'Isi Tgl Kirim Invoice sebelum membuat link pembayaran.');
        const remaining = Math.round(Number(inv.remainingAmount || 0));
        if (inv.paidDate || !(remaining > 0)) throw httpError(400, 'Invoice sudah lunas.');

        // One active link at a time: retire older pending links.
        const old = await db.select().from(paymentLinks).where(and(eq(paymentLinks.invoiceId, inv.id), eq(paymentLinks.status, 'pending')));
        const c = xenditConfig();
        for (const o of old) {
            if (o.providerId && !c.mock) await xendit(`/invoices/${o.providerId}/expire!`, null).catch(() => {});
        }
        if (old.length) await db.update(paymentLinks).set({ status: 'cancelled', updatedAt: new Date() }).where(inArray(paymentLinks.id, old.map((o) => o.id)));

        const externalId = `dsr-inv-${inv.id}-${Date.now()}`;
        const expiresAt = new Date(Date.now() + c.hours * 3600 * 1000);
        let providerId = null, url = null, raw = null;
        if (!c.mock) {
            const appUrl = process.env.APP_URL || 'http://localhost:5173';
            const r = await xendit('/v2/invoices', {
                external_id: externalId, amount: remaining, currency: 'IDR',
                description: `Invoice ${inv.invoiceNumber}${inv.companyName ? ` — ${inv.companyName}` : ''}`.slice(0, 250),
                invoice_duration: c.hours * 3600,
                ...(payerEmail ? { payer_email: payerEmail } : {}),
                ...(inv.companyName ? { customer: { given_names: inv.companyName.slice(0, 100) } } : {}),
                success_redirect_url: `${appUrl}/admin/contracts?tab=portal&paid=${encodeURIComponent(inv.invoiceNumber)}`,
                failure_redirect_url: `${appUrl}/admin/contracts?tab=portal`,
            });
            providerId = r.id; url = r.invoice_url; raw = { id: r.id, status: r.status, expiry_date: r.expiry_date };
        }
        const [link] = await db.insert(paymentLinks).values({
            invoiceId: inv.id, organizationId: inv.organizationId, externalId, providerId, url,
            amount: String(remaining), status: 'pending', expiresAt, raw, createdBy: user?.id || null,
        }).returning();
        return view(link);
    },

    /** Xendit invoice callback. Idempotent; returns a short outcome string. */
    async handleWebhook(body, token) {
        const c = xenditConfig();
        const a = Buffer.from(String(token || '')), b = Buffer.from(c.callbackToken);
        if (!c.callbackToken || a.length !== b.length || !timingSafeEqual(a, b)) throw httpError(401, 'invalid callback token');
        return this._applyStatus(body);
    },

    async _applyStatus(body) {
        const externalId = String(body?.external_id || '');
        const [link] = await db.select().from(paymentLinks).where(eq(paymentLinks.externalId, externalId)).limit(1);
        if (!link) return 'unknown_link';
        const status = String(body.status || '').toUpperCase();
        if (status === 'EXPIRED') {
            await db.update(paymentLinks).set({ status: 'expired', raw: body, updatedAt: new Date() })
                .where(and(eq(paymentLinks.id, link.id), eq(paymentLinks.status, 'pending')));
            return 'expired';
        }
        if (status !== 'PAID' && status !== 'SETTLED') return 'ignored';
        // Claim the transition pending→paid once (Xendit may retry the webhook).
        const paidAt = body.paid_at ? new Date(body.paid_at) : new Date();
        const paidAmount = Number(body.paid_amount ?? body.amount ?? link.amount);
        const won = await db.update(paymentLinks).set({
            status: 'paid', paidAt, paidAmount: String(paidAmount),
            channel: [body.payment_method, body.payment_channel || body.bank_code].filter(Boolean).join(' / ').slice(0, 60) || null,
            raw: body, updatedAt: new Date(),
        }).where(and(eq(paymentLinks.id, link.id), inArray(paymentLinks.status, ['pending', 'expired', 'cancelled']))).returning();
        if (!won.length) return 'already_paid';

        // The invoice may have been cancelled & re-issued under the same number.
        let [inv] = await db.select().from(invoices).where(eq(invoices.id, link.invoiceId)).limit(1);
        if (inv?.isCancelled) {
            [inv] = await db.select().from(invoices).where(and(eq(invoices.invoiceNumber, inv.invoiceNumber),
                eq(invoices.organizationId, inv.organizationId), eq(invoices.isCancelled, false))).limit(1);
        }
        if (!inv) return 'invoice_missing';
        const acc = await booksAutoPost.autoAccounts(inv.organizationId).catch(() => null);
        const cash = acc?.cashAccounts?.find((x) => x.code === c_code()) || null;
        await invoiceService.addPayment(inv.id, {
            amount: paidAmount, paidDate: paidAt.toISOString(),
            note: `Online (Xendit) ${won[0].channel || ''}`.trim().slice(0, 500),
            accountId: cash?.id || acc?.defaultCash || null,
        }, null);
        return 'paid';
    },

    /** Dev only (XENDIT_MOCK=true): pretend Xendit called back with PAID. */
    async simulatePaid(linkId) {
        if (!xenditConfig().mock) throw httpError(400, 'Mode simulasi tidak aktif.');
        const [l] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, Number(linkId))).limit(1);
        if (!l) throw httpError(404, 'Link tidak ditemukan.');
        return this._applyStatus({ external_id: l.externalId, status: 'PAID', paid_amount: Number(l.amount), paid_at: new Date().toISOString(), payment_method: 'SIMULASI', payment_channel: 'MOCK' });
    },
};

const c_code = () => xenditConfig().cashAccountCode;

export default paymentService;
