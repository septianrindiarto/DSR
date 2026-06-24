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

// Render a single car as a one-line label: "Toyota Avanza B 1234 XYZ".
// `cars` lookup (carId -> car) is optional; when a row already carries its
// own `car` object we use that first.
function carLabel(car) {
    if (!car) return null;
    const name = `${esc(car.brand || '')} ${esc(car.name || '')}`.trim();
    const plate = car.licensePlate ? ` <code>${esc(car.licensePlate)}</code>` : '';
    return (name || plate) ? `${name}${plate}` : null;
}

/**
 * Build a rich order-notification message and push it to the admin.
 * Source is one of: 'landing' | 'dashboard' | 'agency' | 'rekap'.
 *
 * Tier 2 multi-vehicle: callers may pass an `orders` array (all rows share
 * one orderNumber). When 2+ rows are present, the message lists each vehicle
 * as its own block and shows a grand total. When only one row is present
 * (or only the legacy `order` is passed), the original single-car layout is
 * used. A per-row `car` object is read first; `carsById` is an optional
 * fallback map (carId -> car) for rows that only carry carId.
 *
 * Never throws.
 */
// Pure message builder — no I/O, exported so it can be unit-tested without a
// Telegram token or network. Returns the HTML string, or null when there are
// no order rows to render.
export function buildOrderMessage({ order, orders, car, carsById, customer, source = 'landing' }) {
    const sourceLabels = {
            landing:   'Landing Page',
            dashboard: 'Dashboard Client',
            agency:    'Admin (manual)',
            rekap:     'Rekap.xlsx sync',
        };
        const sourceLabel = sourceLabels[source] || String(source);

        // Normalise to a rows array. Prefer the explicit `orders` array;
        // fall back to the single `order`. Filter out null/undefined.
        const rows = (Array.isArray(orders) && orders.length > 0 ? orders : [order]).filter(Boolean);
        if (rows.length === 0) {
            return null;
        }

        const lookup = carsById instanceof Map ? carsById : null;
        const resolveCar = (row) =>
            row?.car || (lookup && row?.carId != null ? lookup.get(row.carId) : null) || null;

        const head = rows[0];
        const customerLine = customer?.name ? esc(customer.name) : '-';
        const companyLine = customer?.companyName ? esc(customer.companyName) : 'Private';
        const phone = customer?.phone || customer?.whatsapp || '';
        const waPath = waNumber(phone);
        const isMulti = rows.length > 1;

        const lines = [];
        if (isMulti) {
            lines.push(`🚗 <b>Order baru</b> (${rows.length} kendaraan) via ${esc(sourceLabel)}`);
        } else {
            lines.push(`🚗 <b>Order baru</b> via ${esc(sourceLabel)}`);
        }
        if (head?.orderNumber) lines.push(`<code>${esc(head.orderNumber)}</code>`);
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

        // Trip-level fields shared across all rows (read off the head row).
        if (head?.destination) lines.push(`<b>Tujuan:</b> ${esc(head.destination)}`);
        if (head?.pickupLocation) lines.push(`<b>Penjemputan:</b> ${esc(head.pickupLocation)}`);
        lines.push(`<b>Tanggal:</b> ${fmtDate(head?.pickupDate)} - ${fmtDate(head?.returnDate)}`);
        if (head?.totalDays) lines.push(`<b>Lama:</b> ${head.totalDays} hari`);

        if (isMulti) {
            // One block per vehicle. Use the per-row car object, the carsById
            // fallback, or the single `car` arg as a last resort for row 0.
            lines.push('');
            lines.push(`<b>Kendaraan (${rows.length}):</b>`);
            rows.forEach((row, idx) => {
                const rowCar = resolveCar(row) || (idx === 0 ? car : null);
                const label = carLabel(rowCar) || (row?.package ? esc(row.package) : 'Kategori menyusul');
                const bits = [];
                if (row?.package) bits.push(`paket ${esc(row.package)}`);
                if (Number(row?.overnightNights)) bits.push(`inap ${Number(row.overnightNights)}`);
                if (Number(row?.overtimeHours)) bits.push(`lembur ${Number(row.overtimeHours)} jam`);
                const detail = bits.length ? ` <i>(${bits.join(', ')})</i>` : '';
                const price = row?.totalPrice ? ` — ${fmtRp(row.totalPrice)}` : '';
                lines.push(`${idx + 1}. ${label}${detail}${price}`);
            });
            const grand = rows.reduce((sum, r) => sum + Number(r?.totalPrice || 0), 0);
            if (grand > 0) {
                lines.push('');
                lines.push(`<b>Total estimasi:</b> ${fmtRp(grand)}`);
            }
        } else {
            // Single-car layout (unchanged from the original).
            const rowCar = resolveCar(head) || car;
            lines.push('');
            lines.push(`<b>Kendaraan:</b> ${carLabel(rowCar) || '-'}`);
            if (head?.package) lines.push(`<b>Paket:</b> ${esc(head.package)}`);
            if (head?.totalPrice) lines.push(`<b>Estimasi:</b> ${fmtRp(head.totalPrice)}`);
        }

        // Notes: dedupe across rows (multi-car bookings repeat trip notes).
        const noteSet = [];
        for (const r of rows) {
            const n = (r?.notes || '').trim();
            if (n && !noteSet.includes(n)) noteSet.push(n);
        }
        if (noteSet.length) {
            lines.push('');
            lines.push(`<b>Catatan:</b> ${esc(noteSet.join(' | '))}`);
        }

        lines.push('');
        lines.push(`Status awal: <i>pending</i>. Buka admin panel untuk konfirmasi.`);

        return lines.join('\n');
}

/**
 * Build the order-notification message and push it to the admin. Thin wrapper
 * around buildOrderMessage() + notifyAdmin(). Never throws.
 */
export async function notifyOrderCreated(args) {
    try {
        const text = buildOrderMessage(args);
        if (text == null) return { ok: false, reason: 'no_orders', results: [] };
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
    buildOrderMessage,
};
// Tier 2 multi-vehicle: notifyOrderCreated renders N cars in one message.
