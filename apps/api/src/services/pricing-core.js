// ─── Pricing engine — pure rules (no DB), unit-tested in test/pricing.test.js ─
// Price per vehicle row:
//   unit price/day  = corporate rate (client's negotiated price or % discount)
//                   > model override (rate card with car_model, e.g. "Innova Zenix")
//                   > rate card (category × package × zone)
//                   > car.price (legacy daily price on the unit)
//   base            = unit price × days            (days are inclusive, like orders)
//   + overtime      = overtime hours × overtimePerHour
//   + overnight     = overnight nights × overnightPerNight
//   total           = rounded up to `rounding` (e.g. 1000) × quantity
// Zone: the destination text is matched against the agency's city list; when
// several cities match ("Bandung – Jakarta") the HIGHEST tier wins (the
// farthest point drives the cost). No match → settings.defaultZone, or null
// (= "price on request"). Staff can always override the zone.
// ─────────────────────────────────────────────────────────────────────────────

export const PRICE_CATEGORIES = ['MPV', 'SUV', 'City Car', 'Sedan', 'LCV', 'Pickup', 'CDE'];
export const PRICE_PACKAGES = [
    { key: 'all_in', label: 'All In' },
    { key: 'car_driver', label: 'Mobil dan Driver' },
    { key: 'lepas_kunci', label: 'Lepas Kunci' },
    { key: 'drop', label: 'Drop' },
];
export const ZONES = [1, 2, 3, 4];
export const DEFAULT_PRICING_SETTINGS = {
    overtimePerHour: 0, overnightPerNight: 0, rounding: 1000, publicPrices: true, defaultZone: null,
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function normalizePackage(v) {
    const s = String(v || '').toLowerCase().replace(/[^a-z&]+/g, ' ').trim();
    if (!s) return null;
    if (/all ?in/.test(s)) return 'all_in';
    if (/lepas/.test(s)) return 'lepas_kunci';
    if (/drop/.test(s)) return 'drop';
    if (/mobil|driver|sopir|supir/.test(s)) return 'car_driver';
    return PRICE_PACKAGES.some((p) => p.key === s) ? s : null;
}

/** Category spelling from a list (default PRICE_CATEGORIES; an agency adds its
 *  own vehicle types — Armada → Kelola tipe — via categoriesWith()). */
export function normalizeCategory(v, list = PRICE_CATEGORIES) {
    const s = String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!s) return null;
    return list.find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, '') === s) || null;
}

/** Built-in price categories + an agency's vehicle types (no duplicates). */
export function categoriesWith(types = []) {
    const out = [...PRICE_CATEGORIES];
    const k = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const t of types || []) if (t && !out.some((c) => k(c) === k(t))) out.push(String(t));
    return out;
}

/** "Kota Bandung" / "Kab. Bandung Barat" → "bandung" / "bandung barat" */
export function normCity(v) {
    return String(v || '').toLowerCase()
        .replace(/\b(kota|kabupaten|kab\.?|kec\.?|kecamatan|daerah khusus ibukota|dki)\b/g, ' ')
        .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** zoneCities: [{ cityNorm, zone, city }] */
export function resolveZone(destination, zoneCities = [], defaultZone = null) {
    const text = ` ${normCity(destination)} `;
    let best = null;
    if (text.trim()) {
        for (const z of zoneCities) {
            const c = z.cityNorm || normCity(z.city);
            if (!c) continue;
            if (text.includes(` ${c} `) && (!best || Number(z.zone) > Number(best.zone))) best = z;
        }
    }
    if (best) return { zone: Number(best.zone), source: 'city', city: best.city };
    if (defaultZone) return { zone: Number(defaultZone), source: 'default', city: null };
    return { zone: null, source: null, city: null };
}

/** Inclusive day count, same rule as order creation (min 1). */
export function inclusiveDays(pickupDate, returnDate) {
    const a = new Date(pickupDate), b = new Date(returnDate);
    if (isNaN(a) || isNaN(b)) return 1;
    return Math.max(1, Math.ceil((b - a) / 86400000) + 1);
}

function roundUp(v, step) {
    const s = Number(step) || 0;
    return s > 0 ? Math.ceil(v / s) * s : r2(v);
}

/**
 * rateCards: [{ category, package, zone, carModel, pricePerDay }]
 * corporateRates: [{ category, package, zone (0 = all), pricePerDay, discountPct, validUntil }]
 */
export function unitPriceFor({ category, pkg, zone, carModel = '', carPrice = 0 }, rateCards = [], corporateRates = [], today = new Date().toISOString().slice(0, 10)) {
    const model = String(carModel || '').trim().toLowerCase();
    const card = (m) => rateCards.find((r) => r.category === category && r.package === pkg && Number(r.zone) === Number(zone)
        && String(r.carModel || '').trim().toLowerCase() === m);
    const modelCard = model ? (card(model) || rateCards.find((r) => r.category === category && r.package === pkg
        && Number(r.zone) === Number(zone) && r.carModel && model.includes(String(r.carModel).toLowerCase()))) : null;
    const baseCard = card('');
    const publicPrice = modelCard ? Number(modelCard.pricePerDay) : baseCard ? Number(baseCard.pricePerDay) : 0;
    const publicSource = modelCard ? 'model' : baseCard ? 'rate_card' : (Number(carPrice) > 0 ? 'car' : null);
    const listPrice = publicPrice || Number(carPrice) || 0;

    const valid = (c) => !c.validUntil || String(c.validUntil) >= today;
    const corp = corporateRates.filter(valid).filter((c) => c.category === category && c.package === pkg);
    const corpRow = corp.find((c) => Number(c.zone) === Number(zone)) || corp.find((c) => !Number(c.zone));
    if (corpRow) {
        if (Number(corpRow.pricePerDay) > 0) return { unitPrice: r2(corpRow.pricePerDay), listPrice, source: 'corporate' };
        if (Number(corpRow.discountPct) > 0 && listPrice > 0) {
            return { unitPrice: r2(listPrice * (1 - Number(corpRow.discountPct) / 100)), listPrice, source: 'corporate', discountPct: Number(corpRow.discountPct) };
        }
    }
    return { unitPrice: r2(listPrice), listPrice, source: publicSource };
}

/**
 * items: [{ category, package, quantity, destination, zone?, carModel?, carPrice?, overtimeHours?, overnightNights? }]
 * Returns { days, items: [...priced], total, complete } — complete=false when
 * any item has no price (missing rate / unknown zone / category).
 */
export function computeQuote({ items = [], pickupDate, returnDate, rateCards = [], zoneCities = [], corporateRates = [], settings = {}, categories = PRICE_CATEGORIES }) {
    const cfg = { ...DEFAULT_PRICING_SETTINGS, ...(settings || {}) };
    const days = inclusiveDays(pickupDate, returnDate);
    let total = 0, complete = true;
    const priced = items.map((it) => {
        const category = normalizeCategory(it.category, categories);
        const pkg = normalizePackage(it.package);
        const qty = Math.max(1, Math.min(10, Number(it.quantity) || 1));
        const z = it.zone ? { zone: Number(it.zone), source: 'manual', city: null } : resolveZone(it.destination, zoneCities, cfg.defaultZone);
        const missing = [];
        if (!category) missing.push('category');
        if (!pkg) missing.push('package');
        if (!z.zone) missing.push('zone');
        let unit = { unitPrice: 0, listPrice: 0, source: null };
        if (!missing.length) {
            unit = unitPriceFor({ category, pkg, zone: z.zone, carModel: it.carModel, carPrice: it.carPrice }, rateCards, corporateRates);
        } else if (Number(it.carPrice) > 0) {
            unit = { unitPrice: r2(it.carPrice), listPrice: r2(it.carPrice), source: 'car' }; // legacy unit price, zone-independent
        }
        if (!(unit.unitPrice > 0) && !missing.includes('rate')) missing.push('rate');
        const base = unit.unitPrice * days;
        const overtime = (Number(it.overtimeHours) || 0) * (Number(cfg.overtimePerHour) || 0);
        const overnight = (Number(it.overnightNights) || 0) * (Number(cfg.overnightPerNight) || 0);
        const perUnit = unit.unitPrice > 0 ? roundUp(base + overtime + overnight, cfg.rounding) : 0;
        const lineTotal = perUnit * qty;
        if (!(perUnit > 0)) complete = false;
        total += lineTotal;
        return {
            category, package: pkg, quantity: qty, zone: z.zone, zoneSource: z.source, zoneCity: z.city,
            days, unitPrice: unit.unitPrice, listPrice: unit.listPrice, discountPct: unit.discountPct || null,
            source: unit.source, base: r2(base), overtime: r2(overtime), overnight: r2(overnight),
            perUnit, total: lineTotal, missing: perUnit > 0 ? [] : missing,
        };
    });
    return { days, items: priced, total: r2(total), complete };
}
