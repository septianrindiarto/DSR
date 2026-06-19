// telegram.service.js
//
// Internal notification channel for the agency admin. Built to push push-style
// alerts to the owner's phone whenever an order lands, so the admin can follow
// up the customer via WhatsApp manually (we keep the wa.me deep links for that
// customer-facing path).
//
// Cost: TRULY FREE. Telegram Bot API has no per-message fee and no quota.
//
// Configuration:
//   TELEGRAM_BOT_TOKEN       - From @BotFather, looks like "1234567890:ABC..."
//   TELEGRAM_ADMIN_CHAT_ID   - Comma-separated list of chat ids. Get yours by
//                              visiting https://api.telegram.org/bot<TOKEN>/getUpdates
//                              after sending /start to your bot.
//
// If either env var is missing, the helpers silently no-op and log a one-line
// warning the first time. They NEVER throw, so a Telegram outage cannot break
// the order creation flow.

let _warnedMissingConfig = false;

const API_BASE = 'https://api.telegram.org';

function getConfig() {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const rawChatIds = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
    const chatIds = rawChatIds.split(',').map(s => s.trim()).filter(Boolean);
    return { token, chatIds };
}

export function isTelegramConfigured() {
    const { token, chatIds } = getConfig();
    return Boolean(token && chatIds.length);
}

/**
 * Low-level send. Posts one text message to every configured chat id.
 * Returns { ok, results } - results is the per-chat outcome.
 * Never throws; failures are logged and reflected in the return value.
 */
export async function notifyAdmin(text, options = {}) {
    const { token, chatIds } = getConfig();
    if (!token || chatIds.length === 0) {
        if (!_warnedMissingConfig) {
            console.warn('[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID missing - notifications disabled. Add both to .env to enable.');
            _warnedMissingConfig = true;
        }
        return { ok: false, reason: 'not_configured', results: [] };
    }

    const url = `${API_BASE}/bot${token}/sendMessage`;
    const results = [];

    for (const chatId of chatIds) {
        try {
            const body = {
                chat_id: chatId,
                text,
                parse_mode: options.parseMode || 'HTML',
                disable_web_page_preview: options.disablePreview ?? true,
            };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errBody = await res.text().catch(() => '<no body>');
                console.warn(`[telegram] send failed chat=${chatId} status=${res.status} body=${errBody.slice(0, 200)}`);
                results.push({ chatId, ok: false, status: res.status });
            } else {
                results.push({ chatId, ok: true });
            }
        } catch (err) {
            console.warn(`[telegram] send threw chat=${chatId} err=${err?.message || err}`);
            results.push({ chatId, ok: false, error: err?.message || String(err) });
        }
    }

    return { ok: results.every(r => r.ok), results };
}

// HTML escape so customer names / notes do not break the message body.
function esc(v) {
    if (v == null) return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Format a number as Indonesian Rupiah, used for prices in the alert.
function fmtRp(n) {
    const v = Number(n || 0);
    if (!isFinite(v)) return 'Rp 0';
    return 'Rp ' + v.toLocaleString('id-ID');
}

// Convert a phone string to a wa.me link. Accepts "08...", "+62...", "62...".
// Returns the path part for wa.me (no scheme). If unrecognised, returns "".
function waNumber(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/[^0-9]/g, '');
    if (!digits) return '';
    if (digits.startsWith('62')) return digits;
    if (digits.startsWith('0')) return '62' + digits.slice(1);
    return digits;
}

function fmtDate(d) {
    if (!d) return '-';
    try {
        const date = d instanceof Date ? d : new Date(d);
        if (isNaN(date.getTime())) return '-';
        return date.toLocaleDateString('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric',
        });
    } catch { return '-'; }
}

/**
 * Build a rich order-notification message and push it to the admin.
 * Source is one of: 'landing' | 'dashboard' | 'agency' | 'rekap'.
 * Never throws.
 */
export async function notifyOrderCreated({ order, car, customer, source = 'landing' }) {
    try {
        const sourceLabels = {
            landing:   'Landing Page',
            dashboard: 'Dashboard Client',
            agency:    'Admin (manual)',
            rekap:     'Rekap.xlsx sync',
        };
        const sourceLabel = sourceLabels[source] || String(source);

        const carLine = car
            ? `${esc(car.brand || '')} ${esc(car.name || '')}`.trim() + (car.licensePlate ? ` <code>${esc(car.licensePlate)}</code>` : '')
            : '-';

        const customerLine = customer?.name ? esc(customer.name) : '-';
        const companyLine = customer?.companyName ? esc(customer.companyName) : 'Private';
        const phone = customer?.phone || customer?.whatsapp || '';
        const waPath = waNumber(phone);

        const lines = [];
        lines.push(`🚗 <b>Order baru</b> via ${esc(sourceLabel)}`);
        if (order?.orderNumber) lines.push(`<code>${esc(order.orderNumber)}</code>`);
        lines.push('');
        lines.push(`<b>Nama:</b> ${customerLine}`);
        lines.push(`<b>Perusahaan:</b> ${companyLine}`);
        if (phone) {
            if (waPath) {
                lines.push(`<b>Kontak:</b> ${esc(phone)} - <a href="https://wa.me/${waPath}">Buka WhatsApp</a>`);
            } else {
                lines.push(`<b>Kontak:</b> ${esc(phone)}`);
            }
        }
        lines.push('');
        lines.push(`<b>Kendaraan:</b> ${carLine}`);
        if (order?.package) lines.push(`<b>Paket:</b> ${esc(order.package)}`);
        if (order?.destination) lines.push(`<b>Tujuan:</b> ${esc(order.destination)}`);
        if (order?.pickupLocation) lines.push(`<b>Penjemputan:</b> ${esc(order.pickupLocation)}`);
        lines.push(`<b>Tanggal:</b> ${fmtDate(order?.pickupDate)} - ${fmtDate(order?.returnDate)}`);
        if (order?.totalDays) lines.push(`<b>Lama:</b> ${order.totalDays} hari`);
        if (order?.totalPrice) lines.push(`<b>Estimasi:</b> ${fmtRp(order.totalPrice)}`);
        if (order?.notes) lines.push(`<b>Catatan:</b> ${esc(order.notes)}`);
        lines.push('');
        lines.push(`Status awal: <i>pending</i>. Buka admin panel untuk konfirmasi.`);

        const text = lines.join('\n');
        return await notifyAdmin(text, { parseMode: 'HTML', disablePreview: true });
    } catch (err) {
        console.warn('[telegram] notifyOrderCreated threw:', err?.message || err);
        return { ok: false, reason: 'exception', error: err?.message };
    }
}

export default {
    isTelegramConfigured,
    notifyAdmin,
    notifyOrderCreated,
};
