const API_BASE = 'http://localhost:5000';
// Map Better Auth error messages to friendly Indonesian messages
const errorMessageMap = {
    'User already exists': 'Email sudah terdaftar. Silakan masuk.',
    'User already exists. Use another email.': 'Email sudah terdaftar. Silakan masuk.',
    'Invalid email or password': 'Email atau password salah.',
    'Invalid password': 'Password salah. Silakan coba lagi.',
    'User not found': 'Akun tidak ditemukan.',
    'Password is too short': 'Password terlalu pendek. Minimal 6 karakter.',
};

/**
 * Centralized API client with auth cookie support.
 */
async function request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const config = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
        ...options,
    };

    // Remove Content-Type for FormData (let browser set it)
    if (options.body instanceof FormData) {
        delete config.headers['Content-Type'];
    }

    const response = await fetch(url, config);

    if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: response.statusText }));
        // Better Auth returns { message, code } — map to Indonesian
        const rawMsg = errBody.message || errBody.error || `HTTP ${response.status}`;
        const msg = errorMessageMap[rawMsg] || rawMsg;
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
        updateStatus: (id, status) => api.put(`/api/orders/${id}/status`, { status }),
        assignDriver: (id, driverId) => api.put(`/api/orders/${id}/assign-driver`, { driverId }),
        sendConfirmation: (id) => api.post(`/api/orders/${id}/send-confirmation`, {}),
        stats: () => api.get('/api/orders/stats'),
    },

    // Customers
    customers: {
        list: (params = '') => api.get(`/api/customers?${params}`),
        get: (id) => api.get(`/api/customers/${id}`),
        create: (data) => api.post('/api/customers', data),
        update: (id, data) => api.put(`/api/customers/${id}`, data),
        delete: (id) => api.delete(`/api/customers/${id}`),
        stats: () => api.get('/api/customers/stats'),
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

    // Activity
    activity: {
        list: (params = '') => api.get(`/api/activity?${params}`),
    },

    // Auth
    auth: {
        signUp: (data) => api.post('/api/auth/sign-up/email', data),
        signIn: (data) => api.post('/api/auth/sign-in/email', data),
        signOut: () => api.post('/api/auth/sign-out', {}),
        getSession: () => api.get('/api/auth/get-session'),
    },
};
