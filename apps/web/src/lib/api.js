// Canonical API base URL. Audit C-03: previously declared in 5 separate files
// (CarCard, AdminFleet, AdminSchedule, CarDetail + here). Now exported as the
// single source of truth. Override via VITE_API_BASE in .env for non-dev
// deployments.
export const API_BASE =
    (import.meta?.env?.VITE_API_BASE) || 'http://localhost:5000';

// Audit L-02: shared image-URL helper. Resolves a relative /uploads path to
// the API host without leaking the localhost literal into every component.
export function carImgSrc(url) {
    if (!url) return url;
    return url.startsWith('/uploads') ? `${API_BASE}${url}` : url;
}

// ─── In-memory stale-while-revalidate cache ─────────────────────────────
// Survives client-side navigation (module is shared across React tree). On
// re-mount, pages can read the previous response synchronously and render
// instantly while a fresh fetch runs in the background.
const _cache = new Map(); // key → value
const _inflight = new Map(); // key → Promise (dedupe concurrent fetches)

export const apiCache = {
    get(key) { return _cache.has(key) ? _cache.get(key) : undefined; },
    set(key, value) { _cache.set(key, value); },
    has(key) { return _cache.has(key); },
    /** Drop every cached key whose name starts with `prefix`. Call after mutations. */
    invalidate(prefix) {
        for (const k of _cache.keys()) if (k.startsWith(prefix)) _cache.delete(k);
        for (const k of _inflight.keys()) if (k.startsWith(prefix)) _inflight.delete(k);
    },
    clear() { _cache.clear(); _inflight.clear(); },
};

/**
 * Stale-while-revalidate fetch.
 *   - If we have a cached value, calls onUpdate(cached) synchronously (sync = same tick).
 *   - Then runs the fetcher in the background and calls onUpdate(fresh) when done.
 *   - Concurrent calls for the same key share one in-flight request.
 *
 * Returns the promise of the fresh fetch (so callers can await if they want).
 */
export function swr(key, fetcher, onUpdate) {
    if (_cache.has(key)) {
        try { onUpdate(_cache.get(key), { stale: true }); } catch { /* ignore */ }
    }
    if (_inflight.has(key)) {
        return _inflight.get(key).then(v => { try { onUpdate(v, { stale: false }); } catch { /* ignore */ } return v; });
    }
    const p = Promise.resolve()
        .then(fetcher)
        .then(v => { _cache.set(key, v); _inflight.delete(key); try { onUpdate(v, { stale: false }); } catch { /* ignore */ } return v; })
        .catch(err => { _inflight.delete(key); throw err; });
    _inflight.set(key, p);
    return p;
}

// Map Better Auth error messages to friendly Indonesian messages
const errorMessageMap = {
    'User already exists': 'Email sudah terdaftar. Silakan masuk.',
    'User already exists. Use another email.': 'Email sudah terdaftar. Silakan masuk.',
    'Invalid email or password': 'Email atau password salah.',
    'Invalid password': 'Password salah. Silakan coba lagi.',
    'User not found': 'Akun tidak ditemukan.',
    'Password is too short': 'Password terlalu pendek. Minimal 8 karakter.',
    // Better Auth emits these when requireEmailVerification = true and the
    // user hasn't activated yet. Surface the friendly Indonesian gate.
    'Email not verified': 'Email Anda belum diverifikasi. Cek inbox untuk link aktivasi.',
    'Email verification required': 'Email Anda belum diverifikasi. Cek inbox untuk link aktivasi.',
    'Please verify your email': 'Email Anda belum diverifikasi. Cek inbox untuk link aktivasi.',
    // Generic registration failure — usually means the email is already taken.
    'Failed to create user': 'Pendaftaran gagal. Kemungkinan email sudah dipakai — coba masuk atau pakai email lain.',
};

// Audit C-04. Default request timeout. Long-running endpoints (file
// uploads, bulk imports) can pass a larger opts.timeout per call.
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Centralized API client with auth cookie support.
 *
 * Adds an AbortController with a configurable timeout so a stalled backend
 * does not leave the UI hanging on a spinner indefinitely. Aborted requests
 * surface a friendly Indonesian message rather than a raw DOMException.
 */
// ─── Busy tracking + double-submit guard ─────────────────────────────────────
// Every request is counted so the app can show a top loading bar
// (components/ApiActivityBar.jsx). A mutation (POST/PUT/PATCH/DELETE) fired
// again with the SAME endpoint + body while the first is still running joins
// the first one instead of hitting the server twice — the safety net behind
// buttons that forget to disable themselves (double "Simpan" on slow Neon).
const activity = { reads: 0, writes: 0 };
const activityListeners = new Set();
const emitActivity = () => { const snap = { ...activity }; activityListeners.forEach((fn) => { try { fn(snap); } catch { /* ignore */ } }); };
export const apiActivity = {
    get: () => ({ ...activity }),
    subscribe(fn) { activityListeners.add(fn); return () => activityListeners.delete(fn); },
};
const inflightWrites = new Map();

function request(endpoint, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const isWrite = method !== 'GET' && method !== 'HEAD';
    // FormData bodies can't be compared cheaply → never deduped (uploads).
    const key = isWrite && !(options.body instanceof FormData) && !options.allowDuplicate
        ? `${method} ${endpoint} ${typeof options.body === 'string' ? options.body : ''}` : null;
    if (key && inflightWrites.has(key)) return inflightWrites.get(key);

    // silent: background polling (notification bell) — no top loading bar, and
    // X-Background tells the server it is not user activity (idle timeout).
    if (options.silent) options = { ...options, headers: { ...(options.headers || {}), 'X-Background': '1' } };
    const bucket = isWrite ? 'writes' : 'reads';
    // quiet: user activity (keep-alive ping) without the loading bar.
    const counted = !options.silent && !options.quiet;
    if (counted) { activity[bucket] += 1; emitActivity(); }
    const p = rawRequest(endpoint, options).finally(() => {
        if (counted) { activity[bucket] = Math.max(0, activity[bucket] - 1); emitActivity(); }
        if (key) inflightWrites.delete(key);
    });
    if (key) inflightWrites.set(key, p);
    return p;
}

async function rawRequest(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const {
        timeout = DEFAULT_TIMEOUT_MS,
        signal: externalSignal,
        // eslint-disable-next-line no-unused-vars
        allowDuplicate, skipAuthInterceptor, silent, quiet,
        ...restOptions
    } = options;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    // If the caller supplied their own AbortSignal (e.g. for cancel-on-unmount),
    // chain it so either source can abort the same fetch.
    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const config = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...restOptions.headers,
        },
        ...restOptions,
        signal: controller.signal,
    };

    if (options.body instanceof FormData) {
        delete config.headers['Content-Type'];
    }

    let response;
    try {
        response = await fetch(url, config);
    } catch (err) {
        clearTimeout(timer);
        if (err?.name === 'AbortError') {
            const aborted = externalSignal?.aborted;
            throw new Error(aborted
                ? 'Permintaan dibatalkan.'
                : 'Permintaan terlalu lama. Periksa koneksi Anda dan coba lagi.');
        }
        throw err;
    }
    clearTimeout(timer);

    if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: response.statusText }));
        const rawMsg = errBody.message || errBody.error || `HTTP ${response.status}`;
        const msg = errorMessageMap[rawMsg] || rawMsg;

        // Audit M-05: 401 means the session expired or was invalidated. Fire
        // a global event so AuthContext can clear state and redirect the
        // user to login with a banner, instead of every page showing a raw
        // 'Unauthorized' alert in isolation. Endpoints that legitimately
        // expect 401 in their flow (e.g. /api/auth/get-session probe on
        // mount) can opt out by passing skipAuthInterceptor in options.
        if (response.status === 401 && !options.skipAuthInterceptor) {
            try {
                window.dispatchEvent(new CustomEvent('auth:expired', {
                    detail: { endpoint, rawMsg, code: errBody.code || null, device: errBody.device || null },
                }));
            } catch (_) { /* SSR / Node guard */ }
        }

        // Keep status + body on the error so callers can read structured
        // details (e.g. schedule conflicts on PUT /api/orders/booking-update).
        const e = new Error(msg);
        e.status = response.status;
        e.body = errBody;
        throw e;
    }

    return response.json();
}


// Private documents (SIM/KTP, finance files, legal docs) are never public
// links: fetch with the session cookie and open the blob in a new tab.
async function openPrivateFile(path) {
    const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const api = {
    get: (endpoint) => request(endpoint),
    post: (endpoint, data) => request(endpoint, { method: 'POST', body: data instanceof FormData ? data : JSON.stringify(data) }),
    put: (endpoint, data) => request(endpoint, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (endpoint) => request(endpoint, { method: 'DELETE' }),

    // Cars
    cars: {
        listPublic: () => api.get('/api/cars/public'),
        summary: () => api.get('/api/cars/public/summary'),
        availability: (days = 7) => api.get(`/api/cars/public/availability?days=${days}`),
        list: (params = '') => api.get(`/api/cars?${params}`),
        get: (id) => api.get(`/api/cars/${id}`),
        create: (data) => api.post('/api/cars', data),
        update: (id, data) => api.put(`/api/cars/${id}`, data),
        bulkStatus: (ids, status) => api.put('/api/cars/bulk-status', { ids, status }),
        bulkDelete: (ids) => api.post('/api/cars/bulk-delete', { ids }),
        delete: (id) => api.delete(`/api/cars/${id}`),
        stats: () => api.get('/api/cars/stats'),
        uploadImages: (formData) => api.post('/api/cars/upload', formData),
        exportData: () => api.get('/api/cars/data/export'),
        importData: (data) => api.post('/api/cars/data/import', data),
        // Vehicle types per agency (Armada → Kelola tipe).
        types: () => api.get('/api/cars/types'),
        saveTypes: (types, renames = []) => api.put('/api/cars/types', { types, renames }),
    },

    // Orders
    orders: {
        // Driver trip log (staff view) + private photos / receipts
        trip: (id) => api.get(`/api/orders/${id}/trip`),
        openTripPhoto: (id, phase, idx) => openPrivateFile(`/api/orders/${id}/trip/photo/${phase}/${idx}`),
        openExpenseReceipt: (id, expenseId) => openPrivateFile(`/api/orders/${id}/expense/${expenseId}/receipt`),
        list: (params = '') => api.get(`/api/orders?${params}`),
        get: (id) => api.get(`/api/orders/${id}`),
        createPublic: (data) => api.post('/api/orders/public', data),
        create: (data) => api.post('/api/orders', data),
        update: (id, data) => api.put(`/api/orders/${id}`, data),
        remove: (id) => api.delete(`/api/orders/${id}`),
        updateStatus: (id, status) => api.put(`/api/orders/${id}/status`, { status }),
        assignDriver: (id, driverId) => api.put(`/api/orders/${id}/assign-driver`, { driverId }),
        // Tier 2 multi-vehicle: assign drivers to all cars of a booking at once.
        assignDrivers: (assignments) => api.put('/api/orders/assign-drivers', { assignments }),
        // Tier 2 multi-vehicle: assign fleet cars (units) per row of a booking.
        assignCars: (assignments) => api.put('/api/orders/assign-cars', { assignments }),
        // Tier 2 multi-vehicle: combined per-row update (car + driver + price).
        updateBookingItems: (items) => api.put('/api/orders/booking-items', { items }),
        // Unified ✏️ edit form: { customer?, items: [...], force? } — single order or whole booking.
        updateBooking: (data) => api.put('/api/orders/booking-update', data),
        // Inline single-cell edit: { orderIds, field, value, expectedUpdatedAt?, force? }
        updateField: (data) => api.put('/api/orders/field', data),
        // Row edit: several columns at once, one transaction ({ changes: [{ orderIds, field, value }] }).
        updateFields: (data) => api.put('/api/orders/fields', data),
        // Tier 2 multi-vehicle: cancel an entire booking by its order code.
        cancelBooking: (orderNumber) => api.put(`/api/orders/booking/${encodeURIComponent(orderNumber)}/cancel`, {}),
        // Tier 2 multi-vehicle: delete an entire booking by its order code.
        removeBooking: (orderNumber) => api.delete(`/api/orders/booking/${encodeURIComponent(orderNumber)}`),
        // Company-name suggestions for the booking form (per-user history).
        companySuggestions: () => api.get('/api/orders/company-suggestions'),
        // Stage 2: claim / release an entire booking; list claimable bookings.
        claimable: () => api.get('/api/orders/claimable'),
        claimBooking: (orderNumber) => api.put(`/api/orders/booking/${encodeURIComponent(orderNumber)}/claim`, {}),
        claimBookingsBulk: (orderNumbers) => api.put('/api/orders/booking/claim-bulk', { orderNumbers }),
        releaseBooking: (orderNumber) => api.put(`/api/orders/booking/${encodeURIComponent(orderNumber)}/release`, {}),
        sendConfirmation: (id) => api.post(`/api/orders/${id}/send-confirmation`, {}),
        stats: () => api.get('/api/orders/stats'),
        exportData: () => api.get('/api/orders/data/export'),
        importData: (data) => api.post('/api/orders/data/import', data),
    },

    // Company directory — dedicated address book for invoice/penawaran/perjanjian
    companies: {
        list: (params = '') => api.get(`/api/companies?${params}`),
        get: (id) => api.get(`/api/companies/${id}`),
        lookup: (name) => api.get(`/api/companies/lookup?name=${encodeURIComponent(name)}`),
        create: (data) => api.post('/api/companies', data),
        update: (id, data) => api.put(`/api/companies/${id}`, data),
        delete: (id) => api.delete(`/api/companies/${id}`),
    },

    // Customers
    customers: {
        list: (params = '') => api.get(`/api/customers?${params}`),
        get: (id) => api.get(`/api/customers/${id}`),
        create: (data) => api.post('/api/customers', data),
        update: (id, data) => api.put(`/api/customers/${id}`, data),
        delete: (id) => api.delete(`/api/customers/${id}`),
        bulkDelete: (ids) => api.post('/api/customers/bulk-delete', { ids }),
        deduplicate: () => api.post('/api/customers/deduplicate', {}),
        stats: () => api.get('/api/customers/stats'),
        exportData: () => api.get('/api/customers/data/export'),
        importData: (data) => api.post('/api/customers/data/import', data),
        // UU PDP: erase identifying data, keep orders/invoices.
        anonymize: (id) => api.post(`/api/customers/${id}/anonymize`, {}),
    },

    // Drivers
    drivers: {
        // Driver app login (agency side)
        appAccess: (id) => api.get(`/api/drivers/${id}/app-access`),
        grantAppAccess: (id, email, password) => api.post(`/api/drivers/${id}/app-access`, { email, password }),
        resetAppPassword: (id, password) => api.put(`/api/drivers/${id}/app-access/password`, { password }),
        revokeAppAccess: (id) => api.delete(`/api/drivers/${id}/app-access`),
        list: (params = '') => api.get(`/api/drivers?${params}`),
        available: () => api.get('/api/drivers/available'),
        get: (id) => api.get(`/api/drivers/${id}`),
        create: (data) => api.post('/api/drivers', data),
        update: (id, data) => api.put(`/api/drivers/${id}`, data),
        bulkStatus: (ids, status) => api.put('/api/drivers/bulk-status', { ids, status }),
        delete: (id) => api.delete(`/api/drivers/${id}`),
        upload: (id, formData) => api.post(`/api/drivers/${id}/upload`, formData),
        // kind: licenseDoc | idCard | photo
        openDocument: (id, kind) => openPrivateFile(`/api/drivers/${id}/document/${kind}`),
        stats: () => api.get('/api/drivers/stats'),
        exportData: () => api.get('/api/drivers/data/export'),
        importData: (data) => api.post('/api/drivers/data/import', data),
    },

    // Schedule
    schedule: {
        get: (params = '') => api.get(`/api/schedule?${params}`),
        getCar: (carId, params = '') => api.get(`/api/schedule/${carId}?${params}`),
    },

    // Dashboard
    dashboard: {
        stats: () => api.get('/api/dashboard/stats'),
        recentOrders: (limit = 5) => api.get(`/api/dashboard/recent-orders?limit=${limit}`),
        getPrefs: () => api.get('/api/dashboard/preferences'),
        savePrefs: (widgetConfig) => api.put('/api/dashboard/preferences', { widgetConfig }),
    },

    // Analytics
    analytics: {
        trends: () => api.get('/api/analytics/trends'),
        revenue: () => api.get('/api/analytics/revenue'),
        categories: () => api.get('/api/analytics/categories'),
        topCars: (limit = 10) => api.get(`/api/analytics/top-cars?limit=${limit}`),
        customers: () => api.get('/api/analytics/customers'),
        kpis: () => api.get('/api/analytics/kpis'),
    },

    // Maintenance
    maintenance: {
        list: (params = '') => api.get(`/api/maintenance?${params}`),
        create: (data) => api.post('/api/maintenance', data),
        update: (id, data) => api.put(`/api/maintenance/${id}`, data),
    },

    // Reviews
    reviews: {
        list: (params = '') => api.get(`/api/reviews?${params}`),
        create: (data) => api.post('/api/reviews', data),
    },

    // Finance (document uploads)
    finance: {
        list: (params = '') => api.get(`/api/finance?${params}`),
        get: (id) => api.get(`/api/finance/${id}`),
        create: (data) => api.post('/api/finance', data),
        update: (id, data) => api.put(`/api/finance/${id}`, data),
        delete: (id) => api.delete(`/api/finance/${id}`),
        stats: () => api.get('/api/finance/stats'),
        upload: (formData) => api.post('/api/finance/upload', formData),
        openFile: (id) => openPrivateFile(`/api/finance/${id}/file`),
        exportData: () => api.get('/api/finance/data/export'),
        importData: (data) => api.post('/api/finance/data/import', data),
    },

    // Journal (core financial data + reports)
    journal: {
        list: (params = '') => api.get(`/api/journal?${params}`),
        get: (id) => api.get(`/api/journal/${id}`),
        update: (id, data) => api.put(`/api/journal/${id}`, data),
        delete: (id, force = false) => api.delete(`/api/journal/${id}${force ? '?force=true' : ''}`),
        bulkDelete: (ids, force = false) => api.post('/api/journal/bulk-delete', { ids, force }),
        reverse: (id) => api.post(`/api/journal/${id}/reverse`, {}),
        stats: () => api.get('/api/journal/stats'),
        categories: () => api.get('/api/journal/categories'),
        import: (data) => api.post('/api/journal/import', data),
        clearAll: (data) => api.post('/api/journal/clear', data),
        export: (params = '') => api.get(`/api/journal/export?${params}`),
        deleteBatch: (batchId) => api.delete(`/api/journal/batch/${batchId}`),
        // Period locking
        listLockedPeriods: () => api.get('/api/journal/periods/locked'),
        lockPeriod: (year, month) => api.post('/api/journal/periods/lock', { year, month }),
        unlockPeriod: (id) => api.delete(`/api/journal/periods/lock/${id}`),
        // Reports
        ledger: (params = '') => api.get(`/api/journal/reports/ledger?${params}`),
        trialBalance: (params = '') => api.get(`/api/journal/reports/trial-balance?${params}`),
        incomeStatement: (params = '') => api.get(`/api/journal/reports/income-statement?${params}`),
        cashFlow: (params = '') => api.get(`/api/journal/reports/cash-flow?${params}`),
        balanceSheet: (params = '') => api.get(`/api/journal/reports/balance-sheet?${params}`),
    },

    // Chart of Accounts
    accounts: {
        list: () => api.get('/api/accounts'),
        get: (id) => api.get(`/api/accounts/${id}`),
        create: (data) => api.post('/api/accounts', data),
        update: (id, data) => api.put(`/api/accounts/${id}`, data),
        delete: (id) => api.delete(`/api/accounts/${id}`),
    },

    // Activity
    activity: {
        list: (params = '') => api.get(`/api/activity?${params}`),
    },

    // Rekap → DB sync (Google Drive Excel migration)
    sync: {
        // Rekap.xlsx sync (runRekap/uploadRekap/logs/status) was removed —
        // only the invoice-queue endpoints remain under /api/sync.
        ordersNeedingInvoice: () => api.get('/api/sync/orders/needs-invoice'),
        markInvoiceGenerated: (id, data) => api.put(`/api/sync/orders/${id}/invoice`, data),
        bulkMarkInvoiceGenerated: (data) => api.post('/api/sync/orders/bulk-invoice', data),
    },

    // Auth
    auth: {
        // signUp goes through OUR custom endpoint so phone/customerType/
        // companyName/accountType are captured + a customers row is created.
        signUp: (data) => api.post('/api/auth/register-extended', data),
        // force: take over a login that has been idle ≥ 5 min on another device (owner 2026-11-13).
        signIn: (data, { force = false } = {}) => request('/api/auth/sign-in/email', { method: 'POST', body: JSON.stringify(data), ...(force ? { headers: { 'X-Force-Login': '1' } } : {}) }),
        signOut: () => api.post('/api/auth/sign-out', {}),
        // skipAuthInterceptor: this probe runs on every page load to detect
        // an already-logged-in user. A 401 here just means "not logged in",
        // not "session expired", so it must NOT fire the global banner.
        getSession: () => request('/api/auth/get-session', { skipAuthInterceptor: true }),
        // Email verification — token comes from the activation link.
        verifyEmail: (token) => api.get(`/api/auth/verify-email?token=${encodeURIComponent(token)}`),
        sendVerification: (email) => api.post('/api/auth/send-verification-email', { email }),
        // Two-step verification (Better Auth twoFactor plugin, TOTP).
        twoFactor: {
            enable: (password) => api.post('/api/auth/two-factor/enable', { password }),
            disable: (password) => api.post('/api/auth/two-factor/disable', { password }),
            verifyTotp: (code, trustDevice = false, { force = false } = {}) => request('/api/auth/two-factor/verify-totp', { method: 'POST', body: JSON.stringify({ code, trustDevice }), ...(force ? { headers: { 'X-Force-Login': '1' } } : {}) }),
            verifyBackupCode: (code, { force = false } = {}) => request('/api/auth/two-factor/verify-backup-code', { method: 'POST', body: JSON.stringify({ code }), ...(force ? { headers: { 'X-Force-Login': '1' } } : {}) }),
            generateBackupCodes: (password) => api.post('/api/auth/two-factor/generate-backup-codes', { password }),
        },
        changePassword: (currentPassword, newPassword) => api.post('/api/auth/change-password', { currentPassword, newPassword, revokeOtherSessions: true }),
    },

    // User Management
    users: {
        list: (params = '') => api.get(`/api/users?${params}`),
        create: (data) => api.post('/api/users', data),
        update: (id, data) => api.put(`/api/users/${id}`, data),
        delete: (id) => api.delete(`/api/users/${id}`),
        resetPassword: (id, password) => api.post(`/api/users/${id}/reset-password`, { password }),
        resendVerification: (id) => api.post(`/api/users/${id}/resend-verification`, {}),
        // RBAC v2
        myAccess: () => api.get('/api/users/me/access'),
        accessTemplates: (orgId) => api.get(`/api/users/access/templates${orgId ? `?orgId=${orgId}` : ''}`),
        forkTemplate: (data) => api.post('/api/users/access/templates/fork', data),
        saveTemplate: (data) => data.id ? api.put(`/api/users/access/templates/${data.id}`, data) : api.post('/api/users/access/templates', data),
        deleteTemplate: (id) => api.delete(`/api/users/access/templates/${id}`),
        setDefaultTemplate: (templateKey) => api.put('/api/users/access/default-template', { templateKey }),
        accessAudit: () => api.get('/api/users/access/audit'),
        getAccess: (id) => api.get(`/api/users/${id}/access`),
        setAccess: (id, data) => api.put(`/api/users/${id}/access`, data),
    },

    // Agency legal documents (RBAC v2 onboarding). Files are private: they are
    // fetched as a blob with the session cookie, never via a public URL.
    legal: {
        get: () => api.get('/api/orgs/legal'),
        update: (data) => api.put('/api/orgs/legal', data),
        upload: (doc, file) => { const fd = new FormData(); fd.append('file', file); return api.post(`/api/orgs/legal/file/${doc}`, fd); },
        openFile: (doc) => openPrivateFile(`/api/orgs/legal/file/${doc}`),
    },

    // Self profile (Phase 4B)
    me: {
        get: () => api.get('/api/users/me'),
        update: (data) => api.put('/api/users/me', data),
        exportData: () => api.get('/api/users/me/export'),
    },

    // Org invite codes (Phase 4A) + company info (Phase 4B)
    myOrg: {
        getInviteCode: () => api.get('/api/orgs/my-invite-code'),
        resendInviteCode: () => api.post('/api/orgs/my-invite-code/resend', {}),
        rotateInviteCode: () => api.post('/api/orgs/my-invite-code/rotate', {}),
        getInfo: () => api.get('/api/orgs/my-info'),
        updateInfo: (data) => api.put('/api/orgs/my-info', data),
        // Reserve the next company-wide letter number (No.YY/DSR/NNN).
        nextLetterNumber: () => api.post('/api/orgs/next-letter-number', {}),
        // Surat pengantar number of a kode transaksi (reused if it already has one).
        letterNumberForCode: (code) => api.post('/api/orgs/letter-number-for-code', { code }),
        // Stage 2 — client ↔ agency relationships + affiliate / agency codes.
        myAgencies: () => api.get('/api/orgs/my-agencies'),
        addAgency: (agencyCode) => api.post('/api/orgs/my-agencies', { agencyCode }),
        myClients: () => api.get('/api/orgs/my-clients'),
        addClient: (clientOrgId) => api.post('/api/orgs/my-clients', { clientOrgId }),
        removeLink: (id) => api.delete(`/api/orgs/links/${id}`),
        affiliateCode: () => api.post('/api/orgs/affiliate-code', {}),
        agencyCode: () => api.post('/api/orgs/agency-code', {}),
    },
    // Superadmin: platform-wide organization & relationship management.
    orgsAdmin: {
        list: () => api.get('/api/orgs/all'),
        create: (data) => api.post('/api/orgs/admin', data),
        update: (id, data) => api.put(`/api/orgs/${id}/admin`, data),
        links: () => api.get('/api/orgs/all-links'),
        addLink: (clientOrgId, agencyOrgId) => api.post('/api/orgs/all-links', { clientOrgId, agencyOrgId }),
        removeLink: (id) => api.delete(`/api/orgs/all-links/${id}`),
    },

    // Invoices (D.2) — timeline (tgl kirim / realisasi), re-issue, payment terms.
    // Issuing still happens via api.sync.markInvoiceGenerated / bulkMark… (Dokumen).
    invoices: {
        get: (id) => api.get(`/api/invoices/${id}`),
        byOrder: (orderId) => api.get(`/api/invoices/by-order/${orderId}`),
        update: (id, data) => api.put(`/api/invoices/${id}`, data),
        reissue: (id, reason) => api.post(`/api/invoices/${id}/reissue`, { reason: reason || null }),
        // Cancel (agency admin; unpaid, not in a terbit faktur) — codes go back to 'belum invoice'.
        cancel: (id, reason) => api.post(`/api/invoices/${id}/cancel`, { reason }),
        addPayment: (id, data) => api.post(`/api/invoices/${id}/payments`, data),
        deletePayment: (id, paymentId) => api.delete(`/api/invoices/${id}/payments/${paymentId}`),
        terms: () => api.get('/api/invoices/terms'),
        setDefaultTerm: (days) => api.put('/api/invoices/terms/default', { days }),
        setCompanyTerm: (orgId, days) => api.put(`/api/invoices/terms/company/${orgId}`, { days }),
        cashAccounts: () => api.get('/api/invoices/cash-accounts'),
        paymentLinks: (id) => api.get(`/api/invoices/${id}/payment-links`),
        createPaymentLink: (id, payerEmail) => api.post(`/api/invoices/${id}/payment-link`, { payerEmail: payerEmail || null }),
        // Tax profile (lib/tax.js): agency default + per client; resolve = what applies to a client.
        tax: () => api.get('/api/invoices/tax'),
        resolveTax: (clientOrgId) => api.get(`/api/invoices/tax/resolve${clientOrgId ? `?clientOrgId=${clientOrgId}` : ''}`),
        setDefaultTax: (profile) => api.put('/api/invoices/tax/default', { profile }),
        setCompanyTax: (orgId, profile) => api.put(`/api/invoices/tax/company/${orgId}`, { profile }),
    },

    // Faktur Pajak (Dokumen → Faktur Pajak): one faktur = 1..n invoices of one buyer in one masa.
    faktur: {
        list: (params = {}) => api.get(`/api/faktur?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()}`),
        candidates: (params = {}) => api.get(`/api/faktur/candidates?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()}`),
        get: (id) => api.get(`/api/faktur/${id}`),
        create: (data) => api.post('/api/faktur', data),
        update: (id, data) => api.put(`/api/faktur/${id}`, data),
        cancel: (id, reason) => api.post(`/api/faktur/${id}/cancel`, { reason: reason || null }),
        replace: (id) => api.post(`/api/faktur/${id}/replace`, {}),
        uploadFile: (id, file) => { const fd = new FormData(); fd.append('file', file); return api.post(`/api/faktur/${id}/file`, fd); },
        openFile: (id) => openPrivateFile(`/api/faktur/${id}/file`),
        exportCsv: (masa) => openPrivateFile(`/api/faktur/export.csv${masa ? `?masa=${masa}` : ''}`),
    },

    // Driver app (/driver) — the logged-in driver's own data.
    driverApp: {
        me: () => api.get('/api/driver-app/me'),
        assignments: () => api.get('/api/driver-app/assignments'),
        startTrip: (orderId, formData) => api.post(`/api/driver-app/trips/${orderId}/start`, formData),
        finishTrip: (orderId, formData) => api.post(`/api/driver-app/trips/${orderId}/finish`, formData),
        expenses: () => api.get('/api/driver-app/expenses'),
        addExpense: (formData) => api.post('/api/driver-app/expenses', formData),
    },

    // Long-term contracts (Kontrak).
    contracts: {
        list: (status = '') => api.get(`/api/contracts${status ? `?status=${status}` : ''}`),
        get: (id) => api.get(`/api/contracts/${id}`),
        create: (data) => api.post('/api/contracts', data),
        update: (id, data) => api.put(`/api/contracts/${id}`, data),
        setStatus: (id, status) => api.put(`/api/contracts/${id}/status`, { status }),
        billingPreview: (id, period, kmOverrides) => api.post(`/api/contracts/${id}/billing/preview`, { period, kmOverrides: kmOverrides || {} }),
        issueBilling: (id, data) => api.post(`/api/contracts/${id}/billing`, data),
        // Workflow: both sides approve; required documents (defined by one side, uploaded by the other).
        approve: (id, side) => api.post(`/api/contracts/${id}/approve`, side ? { side } : {}),
        addDocument: (id, data) => api.post(`/api/contracts/${id}/documents`, data),
        updateDocument: (id, docId, data) => api.put(`/api/contracts/${id}/documents/${docId}`, data),
        removeDocument: (id, docId) => api.delete(`/api/contracts/${id}/documents/${docId}`),
        uploadDocument: (id, docId, file) => { const fd = new FormData(); fd.append('file', file); return api.post(`/api/contracts/${id}/documents/${docId}/file`, fd); },
        openDocument: (id, docId) => openPrivateFile(`/api/contracts/${id}/documents/${docId}/file`),
        removeDocumentFile: (id, docId) => api.delete(`/api/contracts/${id}/documents/${docId}/file`),
        invoices: (id) => api.get(`/api/contracts/${id}/invoices`),
        // Monthly M codes (one per unit per month), List Data, audit trail, amendments.
        monthly: (params = {}) => api.get(`/api/contracts/monthly?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()}`),
        monthlyRecalc: (billingId, km) => api.post(`/api/contracts/monthly/${billingId}/recalc`, { km: km === '' || km == null ? null : km }),
        monthlyGenerate: (contractId) => api.post('/api/contracts/monthly/generate', { contractId }),
        // Form → Kontrak: monthly M detail form (fill → both sides approve → invoiceable).
        // Replacement units per contract unit (maintenance / emergency).
        replacements: (id) => api.get(`/api/contracts/${id}/replacements`),
        addReplacement: (id, data) => api.post(`/api/contracts/${id}/replacements`, data),
        endReplacement: (rid, endDate) => api.post(`/api/contracts/replacements/${rid}/end`, { endDate: endDate || null }),
        monthlyGet: (billingId) => api.get(`/api/contracts/monthly/${billingId}`),
        monthlySave: (billingId, data) => api.put(`/api/contracts/monthly/${billingId}`, data),
        monthlyApprove: (ids, side) => api.post('/api/contracts/monthly/approve', { ids, ...(side ? { side } : {}) }),
        monthlyReject: (ids, reason, side) => api.post('/api/contracts/monthly/reject', { ids, reason, ...(side ? { side } : {}) }),
        monthlyComment: (billingId, text) => api.post(`/api/contracts/monthly/${billingId}/comments`, { text }),
        monthlyAddEvidence: (billingId, formData) => request(`/api/contracts/monthly/${billingId}/evidence`, { method: 'POST', body: formData, timeout: 120_000 }),
        monthlyOpenEvidence: (billingId, idx) => openPrivateFile(`/api/contracts/monthly/${billingId}/evidence/${idx}`),
        monthlyRemoveEvidence: (billingId, idx) => api.delete(`/api/contracts/monthly/${billingId}/evidence/${idx}`),
        codes: (params = {}) => api.get(`/api/contracts/codes?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()}`),
        audit: (params = {}) => api.get(`/api/contracts/audit?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()}`),
        amend: (id, startDate) => api.post(`/api/contracts/${id}/amend`, startDate ? { startDate } : {}),
        supersede: (id, endDate) => api.post(`/api/contracts/${id}/supersede`, { endDate }),
        reviewDocument: (id, docId, decision, note) => api.post(`/api/contracts/${id}/documents/${docId}/review`, { decision, note: note || null }),
    },

    // Rekap Operasional & Lembur (monthly contracts) — entries, evidence, R recaps.
    ops: {
        // Agency default lembur & perjalanan dinas (Pengaturan) — contracts without own terms + daily orders.
        policyDefault: () => api.get('/api/ops/policy-default'),
        setPolicyDefault: (policy) => api.put('/api/ops/policy-default', { policy }),
        overview: (period) => api.get(`/api/ops/overview${period ? `?period=${period}` : ''}`),
        contracts: () => api.get('/api/ops/contracts'),
        list: (params = {}) => api.get(`/api/ops/entries?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()}`),
        create: (formData) => request('/api/ops/entries', { method: 'POST', body: formData, timeout: 120_000 }),
        update: (id, data) => api.put(`/api/ops/entries/${id}`, data),
        remove: (id) => api.delete(`/api/ops/entries/${id}`),
        comment: (id, text) => api.post(`/api/ops/entries/${id}/comments`, { text }),
        addEvidence: (id, formData) => request(`/api/ops/entries/${id}/evidence`, { method: 'POST', body: formData, timeout: 120_000 }),
        openEvidence: (id, idx) => openPrivateFile(`/api/ops/entries/${id}/evidence/${idx}`),
        removeEvidence: (id, idx) => api.delete(`/api/ops/entries/${id}/evidence/${idx}`),
        submit: (ids) => api.post('/api/ops/entries/submit', { ids }),
        verify: (ids) => api.post('/api/ops/entries/verify', { ids }),
        reject: (ids, reason, side) => api.post('/api/ops/entries/reject', { ids, reason, ...(side ? { side } : {}) }),
        // Two-sided approval per form (agency + client). side only for superadmin.
        approve: (ids, side) => api.post('/api/ops/entries/approve', { ids, ...(side ? { side } : {}) }),
        // Dokumen → Invoice from approved form codes (L### lembur, R### operasional).
        billingPending: () => api.get('/api/ops/billing/pending'),
        billingLines: (codes) => api.get(`/api/ops/billing/lines?codes=${encodeURIComponent(codes)}`),
        billingIssue: (data) => api.post('/api/ops/billing/issue', data),
        recaps: (params = {}) => api.get(`/api/ops/recaps?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()}`),
        recapPreview: (data) => api.post('/api/ops/recaps/preview', data),
        createRecap: (data) => api.post('/api/ops/recaps', data),
        recap: (id) => api.get(`/api/ops/recaps/${id}`),
        refreshRecap: (id) => api.post(`/api/ops/recaps/${id}/refresh`, {}),
        cancelRecap: (id) => api.post(`/api/ops/recaps/${id}/cancel`, {}),
        approveRecap: (id) => api.post(`/api/ops/recaps/${id}/approve`, {}),
        rejectRecapEntries: (id, ids, reason) => api.post(`/api/ops/recaps/${id}/reject-entries`, { ids, reason }),
        holidays: (year) => api.get(`/api/ops/holidays${year ? `?year=${year}` : ''}`),
        addHoliday: (data) => api.post('/api/ops/holidays', data),
        removeHoliday: (id) => api.delete(`/api/ops/holidays/${id}`),
    },

    // Fleet care (Perawatan & Dokumen).
    // In-app notifications per user + "Perlu tindakan" counters (dashboard, header bell).
    // Login session rules (idle timeout warning, keep-alive after real use).
    session: {
        policy: () => api.get('/api/session/policy'),
        ping: () => request('/api/session/ping', { method: 'POST', body: '{}', quiet: true, allowDuplicate: true }),
        check: () => request('/api/session/policy', { silent: true }),
    },
    inbox: {
        feed: (params = {}, { silent = false } = {}) => request(`/api/inbox?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()}`, { silent }),
        read: (ids) => api.post('/api/inbox/read', ids ? { ids } : {}),
        actions: ({ silent = false } = {}) => request('/api/inbox/actions', { silent }),
    },
    fleetCare: {
        list: () => api.get('/api/fleet-care'),
        update: (carId, data) => api.put(`/api/fleet-care/${carId}`, data),
        readings: (carId) => api.get(`/api/fleet-care/${carId}/odometer`),
        addReading: (carId, km, readingDate) => api.post(`/api/fleet-care/${carId}/odometer`, { km, readingDate: readingDate || null }),
        recordService: (carId, data) => api.post(`/api/fleet-care/${carId}/service`, data),
        // Maintenance schedule + emergency reports (owner 2026-11-13).
        events: (carId) => api.get(`/api/fleet-care/${carId}/events`),
        addMaintenance: (carId, data) => api.post(`/api/fleet-care/${carId}/maintenance`, data),
        updateMaintenance: (id, data) => api.put(`/api/fleet-care/maintenance/${id}`, data),
        removeMaintenance: (id) => api.delete(`/api/fleet-care/maintenance/${id}`),
        incidents: (status = 'open') => api.get(`/api/fleet-care/incidents?status=${encodeURIComponent(status)}`),
        reportIncident: (data) => api.post('/api/fleet-care/incidents', data),
        resolveIncident: (id, resolution) => api.post(`/api/fleet-care/incidents/${id}/resolve`, { resolution: resolution || null }),
    },

    // Marketplace — ratings & agency profiles (Phase C).
    marketplace: {
        mine: () => api.get('/api/marketplace/reviews/mine'),
        rate: (orderNumber, rating, comment) => api.post(`/api/marketplace/reviews/${encodeURIComponent(orderNumber)}`, { rating, comment: comment || null }),
        agency: (id) => api.get(`/api/marketplace/agencies/${id}`),
        myAgency: () => api.get('/api/marketplace/agency/me'),
    },

    // Online payment (Xendit).
    payments: {
        status: () => api.get('/api/payments/status'),
        simulate: (linkId) => api.post(`/api/payments/links/${linkId}/simulate`, {}),
    },

    // Pricing engine (rate cards, zones, corporate rates) — Tarif.
    pricing: {
        meta: () => api.get('/api/pricing/meta'),
        quote: (data) => api.post('/api/pricing/quote', data),
        config: () => api.get('/api/pricing/config'),
        saveRateCards: (rows) => api.put('/api/pricing/rate-cards', { rows }),
        saveZones: (cities) => api.put('/api/pricing/zones', { cities }),
        saveSettings: (data) => api.put('/api/pricing/settings', data),
        corporate: (clientOrgId) => api.get(`/api/pricing/corporate/${clientOrgId}`),
        saveCorporate: (clientOrgId, rates) => api.put(`/api/pricing/corporate/${clientOrgId}`, { rates }),
    },

    // Corporate portal (client companies) + monthly invoice (agency).
    corporate: {
        bookingRules: () => api.get('/api/corporate/booking-rules'),
        settings: () => api.get('/api/corporate/settings'),
        saveSettings: (data) => api.put('/api/corporate/settings', data),
        addCostCenter: (data) => api.post('/api/corporate/cost-centers', data),
        updateCostCenter: (id, data) => api.put(`/api/corporate/cost-centers/${id}`, data),
        approvals: (status = 'waiting') => api.get(`/api/corporate/approvals?status=${status}`),
        approvalsCount: () => api.get('/api/corporate/approvals/count'),
        decide: (orderNumber, decision, note) => api.post(`/api/corporate/approvals/${encodeURIComponent(orderNumber)}`, { decision, note: note || null }),
        spend: (year) => api.get(`/api/corporate/spend?year=${year}`),
        monthlyPreview: (clientOrgId, month) => api.get(`/api/invoices/monthly/preview?clientOrgId=${clientOrgId}&month=${month}`),
        issueMonthly: (data) => api.post('/api/invoices/monthly', data),
        invoices: () => api.get('/api/corporate/invoices'),
        report: (period) => api.get(`/api/corporate/report?period=${period}`),
        sendReport: (period) => api.post('/api/corporate/report/send', { period }),
        payInvoice: (id) => api.post(`/api/corporate/invoices/${id}/pay`, {}),
    },

    // Books v2 — double-entry journal + financial statements (Keuangan).
    books: {
        accounts: () => api.get('/api/books/accounts'),
        seedAccounts: () => api.post('/api/books/accounts/seed', {}),
        createAccount: (data) => api.post('/api/books/accounts', data),
        updateAccount: (id, data) => api.put(`/api/books/accounts/${id}`, data),
        deleteAccount: (id) => api.delete(`/api/books/accounts/${id}`),
        suggest: (labels) => api.post('/api/books/import/suggest', { labels }),
        importCashbook: (data) => api.post('/api/books/import/cashbook', data),
        locks: () => api.get('/api/books/locks'),
        lock: (year, month) => api.post('/api/books/locks', { year, month }),
        unlock: (id) => api.delete(`/api/books/locks/${id}`),
        // name: trial-balance | income-statement | balance-sheet | cash-flow | equity | ledger | insights
        report: (name, params) => api.get(`/api/books/reports/${name}?${new URLSearchParams(params).toString()}`),
        transactions: (params) => api.get(`/api/books/transactions?${new URLSearchParams(params).toString()}`),
        transaction: (id) => api.get(`/api/books/transactions/${id}`),
        createTx: (data) => api.post('/api/books/transactions', data),
        updateTx: (id, data) => api.put(`/api/books/transactions/${id}`, data),
        deleteTx: (id) => api.delete(`/api/books/transactions/${id}`),
        postTx: (data) => api.post('/api/books/transactions/post', data),
        deleteBatch: (batchId) => api.delete(`/api/books/batches/${encodeURIComponent(batchId)}`),
        reverseTx: (id, data) => api.post(`/api/books/transactions/${id}/reverse`, data || {}),
        quickTypes: () => api.get('/api/books/quick/types'),
        quick: (data) => api.post('/api/books/quick', data),
        autoStatus: () => api.get('/api/books/auto/status'),
        autoResync: () => api.post('/api/books/auto/resync', {}),
    },

    // Access Requests (Phase 3)
    accessRequests: {
        create: (featureKey, note) => api.post('/api/access-requests', { featureKey, note }),
        listPending: () => api.get('/api/access-requests/pending'),
        approve: (id) => api.put(`/api/access-requests/${id}/approve`, {}),
        reject: (id) => api.put(`/api/access-requests/${id}/reject`, {}),
    },

    // Notification channels (admin-only). Telegram is the first wired up.
    notifications: {
        telegramStatus: () => api.get('/api/notifications/telegram/status'),
        telegramTest: () => api.post('/api/notifications/telegram/test', {}),
    },

    // Organizations
    orgs: {
        list: () => api.get('/api/users/orgs'),
        create: (data) => api.post('/api/users/orgs', data),
        update: (id, data) => api.put(`/api/users/orgs/${id}`, data),
        delete: (id) => api.delete(`/api/users/orgs/${id}`),
    },
};
