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
    'Password is too short': 'Password terlalu pendek. Minimal 6 karakter.',
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
async function request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const {
        timeout = DEFAULT_TIMEOUT_MS,
        signal: externalSignal,
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
                    detail: { endpoint, rawMsg },
                }));
            } catch (_) { /* SSR / Node guard */ }
        }

        throw new Error(msg);
    }

    return response.json();
}


export const api = {
    get: (endpoint) => request(endpoint),
    post: (endpoint, data) => request(endpoint, { method: 'POST', body: data instanceof FormData ? data : JSON.stringify(data) }),
    put: (endpoint, data) => request(endpoint, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (endpoint) => request(endpoint, { method: 'DELETE' }),

    // Cars
    cars: {
        listPublic: () => api.get('/api/cars/public'),
        list: (params = '') => api.get(`/api/cars?${params}`),
        get: (id) => api.get(`/api/cars/${id}`),
        create: (data) => api.post('/api/cars', data),
        update: (id, data) => api.put(`/api/cars/${id}`, data),
        delete: (id) => api.delete(`/api/cars/${id}`),
        stats: () => api.get('/api/cars/stats'),
        uploadImages: (formData) => api.post('/api/cars/upload', formData),
        exportData: () => api.get('/api/cars/data/export'),
        importData: (data) => api.post('/api/cars/data/import', data),
    },

    // Orders
    orders: {
        list: (params = '') => api.get(`/api/orders?${params}`),
        get: (id) => api.get(`/api/orders/${id}`),
        createPublic: (data) => api.post('/api/orders/public', data),
        create: (data) => api.post('/api/orders', data),
        update: (id, data) => api.put(`/api/orders/${id}`, data),
        remove: (id) => api.delete(`/api/orders/${id}`),
        updateStatus: (id, status) => api.put(`/api/orders/${id}/status`, { status }),
        assignDriver: (id, driverId) => api.put(`/api/orders/${id}/assign-driver`, { driverId }),
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
    },

    // Drivers
    drivers: {
        list: (params = '') => api.get(`/api/drivers?${params}`),
        available: () => api.get('/api/drivers/available'),
        get: (id) => api.get(`/api/drivers/${id}`),
        create: (data) => api.post('/api/drivers', data),
        update: (id, data) => api.put(`/api/drivers/${id}`, data),
        delete: (id) => api.delete(`/api/drivers/${id}`),
        upload: (id, formData) => api.post(`/api/drivers/${id}/upload`, formData),
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
        runRekap: () => api.post('/api/sync/rekap', {}),
        uploadRekap: (file) => {
            const fd = new FormData();
            fd.append('file', file);
            return api.post('/api/sync/rekap/upload', fd);
        },
        logs: () => api.get('/api/sync/logs'),
        status: () => api.get('/api/sync/status'),
        ordersNeedingInvoice: () => api.get('/api/sync/orders/needs-invoice'),
        markInvoiceGenerated: (id, data) => api.put(`/api/sync/orders/${id}/invoice`, data),
        bulkMarkInvoiceGenerated: (data) => api.post('/api/sync/orders/bulk-invoice', data),
    },

    // Auth
    auth: {
        // signUp goes through OUR custom endpoint so phone/customerType/
        // companyName/accountType are captured + a customers row is created.
        signUp: (data) => api.post('/api/auth/register-extended', data),
        signIn: (data) => api.post('/api/auth/sign-in/email', data),
        signOut: () => api.post('/api/auth/sign-out', {}),
        // skipAuthInterceptor: this probe runs on every page load to detect
        // an already-logged-in user. A 401 here just means "not logged in",
        // not "session expired", so it must NOT fire the global banner.
        getSession: () => request('/api/auth/get-session', { skipAuthInterceptor: true }),
        // Email verification — token comes from the activation link.
        verifyEmail: (token) => api.get(`/api/auth/verify-email?token=${encodeURIComponent(token)}`),
        sendVerification: (email) => api.post('/api/auth/send-verification-email', { email }),
    },

    // User Management
    users: {
        list: (params = '') => api.get(`/api/users?${params}`),
        create: (data) => api.post('/api/users', data),
        update: (id, data) => api.put(`/api/users/${id}`, data),
        delete: (id) => api.delete(`/api/users/${id}`),
        resetPassword: (id, password) => api.post(`/api/users/${id}/reset-password`, { password }),
    },

    // Self profile (Phase 4B)
    me: {
        get: () => api.get('/api/users/me'),
        update: (data) => api.put('/api/users/me', data),
    },

    // Org invite codes (Phase 4A) + company info (Phase 4B)
    myOrg: {
        getInviteCode: () => api.get('/api/orgs/my-invite-code'),
        resendInviteCode: () => api.post('/api/orgs/my-invite-code/resend', {}),
        rotateInviteCode: () => api.post('/api/orgs/my-invite-code/rotate', {}),
        getInfo: () => api.get('/api/orgs/my-info'),
        updateInfo: (data) => api.put('/api/orgs/my-info', data),
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
