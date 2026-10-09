// ─── Order-submission idempotency (short-window, in-memory) ──────────────────
// Collapses a TRULY IDENTICAL booking submitted within WINDOW_MS from any entry
// point — a double-click, two browser tabs, or a network retry all produce the
// same signature and yield ONE order. If ANY field differs (category, unit,
// dates, price, destination …) the signature changes and it's treated as a
// genuinely new order — matching the business reality that a customer's demand
// can legitimately repeat with a variation.
//
// State is per-process and disposable: DSR runs a single PM2 instance and the
// window is tiny, so an in-memory Map is sufficient (no DB, no migration).
const WINDOW_MS = 30_000;
const seen = new Map(); // signature -> { orderNumber, ts }

function prune(now) {
    for (const [k, v] of seen) if (now - v.ts > WINDOW_MS) seen.delete(k);
}

// If this exact signature was seen within the window, return its entry (caller
// treats it as a duplicate). Otherwise RESERVE it synchronously — so a
// concurrent identical request (second tab) is caught — and return null.
export function reserveIdempotency(signature) {
    const now = Date.now();
    prune(now);
    const hit = seen.get(signature);
    if (hit && now - hit.ts <= WINDOW_MS) return hit;
    seen.set(signature, { orderNumber: null, ts: now });
    return null;
}

// Attach the resulting order code after a successful create.
export function recordIdempotency(signature, orderNumber) {
    seen.set(signature, { orderNumber, ts: Date.now() });
}

// Release a reservation when the create FAILED, so a legitimate retry of a
// failed submission isn't wrongly blocked as a duplicate.
export function releaseIdempotency(signature) {
    seen.delete(signature);
}
