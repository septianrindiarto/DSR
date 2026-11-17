// ─── Vehicle types per agency (pure; test/fleet.test.js; owner 2026-11-11) ──
// Each agency keeps its own list in organizations.fleet_options.types. Until
// it saves one, the built-in list below is used (the old fixed dropdown).
export const DEFAULT_CAR_TYPES = ['MPV', 'SUV', 'Sedan', 'City Car', 'Sport'];
export const MAX_TYPES = 50;
export const MAX_TYPE_LEN = 40;

export const cleanType = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TYPE_LEN);
const key = (v) => cleanType(v).toLowerCase();

/** Normalised list: trimmed, no blanks, no case-insensitive duplicates, capped. */
export function carTypesOf(raw) {
    const list = Array.isArray(raw?.types) ? raw.types : null;
    if (!list) return [...DEFAULT_CAR_TYPES];
    const out = [], seen = new Set();
    for (const t of list) {
        const c = cleanType(t);
        if (!c || seen.has(key(c))) continue;
        seen.add(key(c)); out.push(c);
        if (out.length >= MAX_TYPES) break;
    }
    return out;
}

/** The list's own spelling of a type ("city car" → "City Car"), or null. */
export function matchType(list, v) {
    const k = key(v);
    return k ? list.find((t) => key(t) === k) || null : null;
}

/**
 * Validate an edit of the list.
 *   next    the new list (in order)
 *   renames [{ from, to }] — cars of type `from` move to `to`
 *   usage   { type: count of cars }
 * → { types, renames, errors }   errors: types still used by cars but removed.
 */
export function planTypeChange({ next = [], renames = [], usage = {} }) {
    const types = carTypesOf({ types: next });
    const errors = [];
    if (!types.length) errors.push('Minimal satu tipe kendaraan.');
    const cleanRenames = [];
    for (const r of renames || []) {
        const from = cleanType(r?.from), to = matchType(types, r?.to);
        if (!from || !to || key(from) === key(to)) continue;
        cleanRenames.push({ from, to });
    }
    const movedAway = new Set(cleanRenames.map((r) => key(r.from)));
    for (const [t, n] of Object.entries(usage || {})) {
        if (!n || matchType(types, t) || movedAway.has(key(t))) continue;
        errors.push(`Tipe "${t}" masih dipakai ${n} unit — ganti nama atau pindahkan unitnya dulu.`);
    }
    return { types, renames: cleanRenames, errors };
}
