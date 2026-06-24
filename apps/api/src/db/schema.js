import { pgTable, text, varchar, integer, serial, boolean, timestamp, decimal, json, jsonb, pgEnum } from 'drizzle-orm/pg-core';

// ─── Enums ───────────────────────────────────────────────────────────
export const carStatusEnum = pgEnum('car_status', ['available', 'rented', 'maintenance']);
export const carTypeEnum = pgEnum('car_type', ['MPV', 'SUV', 'Sedan', 'City Car', 'Sport']);
export const carCategoryEnum = pgEnum('car_category', ['economy', 'standard', 'premium', 'luxury']);
export const transmissionEnum = pgEnum('transmission', ['Automatic', 'Manual']);
export const fuelEnum = pgEnum('fuel_type', ['Bensin', 'Diesel', 'Pertamax', 'Electric']);
export const orderStatusEnum = pgEnum('order_status', ['pending', 'confirmed', 'active', 'completed', 'cancelled']);
export const customerStatusEnum = pgEnum('customer_status', ['active', 'vip', 'inactive', 'pending']);
export const customerTypeEnum = pgEnum('customer_type', ['private', 'company']);
export const driverStatusEnum = pgEnum('driver_status', ['active', 'inactive', 'suspended']);
export const maintenanceStatusEnum = pgEnum('maintenance_status', ['scheduled', 'in_progress', 'completed']);
export const maintenanceTypeEnum = pgEnum('maintenance_type', ['routine', 'repair', 'inspection']);
export const activityActionEnum = pgEnum('activity_action', ['create', 'update', 'delete', 'login', 'logout', 'approve', 'reject', 'confirm']);
export const userRoleEnum = pgEnum('user_role', ['admin', 'superadmin', 'agent', 'demo', 'client', 'client_admin']);
export const finCategoryEnum = pgEnum('fin_category', ['keuangan_inti', 'perpajakan', 'aset_armada', 'kepatuhan', 'operasional', 'payroll']);
export const finStatusEnum = pgEnum('fin_status', ['draft', 'submitted', 'final', 'archived']);
export const accessRequestStatusEnum = pgEnum('access_request_status', ['pending', 'approved', 'rejected']);

// ─── Organizations (tenant companies / partners) ─────────────────────
// Each partner company that gets an account on the platform is one row here.
// All operational data (orders, cars, customers, …) has organization_id → here.
export const organizations = pgTable('organizations', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull().unique(),
    // Lowercased + trimmed name used for soft duplicate detection. Filled by
    // the registration endpoint when a new org is created.
    nameNormalized: text('name_normalized'),
    slug: varchar('slug', { length: 100 }).unique(),
    isActive: boolean('is_active').notNull().default(true),
    // Phase 4A — one admin per org. Joined via FK (text → user.id).
    // The DB enforces uniqueness with a partial UNIQUE INDEX (see migration);
    // Drizzle treats it as a regular nullable text column.
    adminUserId: text('admin_user_id'),
    // 8-char alphanumeric code generated when the org is created. Subsequent
    // team members register by entering this code instead of typing the
    // company name (avoids fuzzy-match / duplicate-org problems).
    inviteCode: varchar('invite_code', { length: 12 }),
    // Phase 4B — per-org company info that used to be hardcoded in
    // AdminSettings.jsx. Appears on invoices, receipts, surat jalan, etc.
    address: text('address'),
    phone1: varchar('phone1', { length: 50 }),
    phone2: varchar('phone2', { length: 50 }),
    email: varchar('email', { length: 255 }),
    signatory: varchar('signatory', { length: 255 }),
    brand: varchar('brand', { length: 100 }),
    npwp: varchar('npwp', { length: 30 }),
    notes: text('notes'),
    // Phase 4C-1 — display_id is the human-readable org identifier
    // (e.g. "DRC_20260614"). UNIQUE; generated at registration. parent_agency_id
    // links a client org to its owning agency (NULL for agency orgs themselves).
    displayId: varchar('display_id', { length: 20 }),
    parentAgencyId: integer('parent_agency_id'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Better Auth Tables ──────────────────────────────────────────────
export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: userRoleEnum('role').default('admin'),
    // Phase 4A — account_type is the "flag" dimension (agency vs client),
    // role is now just admin/user/superadmin/demo. Backend permission checks
    // gate on both.
    accountType: varchar('account_type', { length: 20 }).default('client'),
    // Multi-tenancy extensions
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: boolean('is_demo').notNull().default(false),
    // Per-user permission overrides — e.g. {"view_all_orders": true} grants a
    // plain client access to every order. Filled by admins via the access
    // request flow (Phase 3). Default {} means "no overrides".
    // NB: column is declared without .notNull() in Drizzle so the Better Auth
    // adapter doesn't have to supply a value on INSERT. The DB-side migration
    // (drizzle/client_scope_migration.sql) enforces NOT NULL DEFAULT '{}'::jsonb,
    // which fills in '{}' automatically.
    permissions: jsonb('permissions').default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Application Tables ──────────────────────────────────────────────

export const cars = pgTable('cars', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    brand: varchar('brand', { length: 100 }).notNull(),
    type: carTypeEnum('type').notNull(),
    category: carCategoryEnum('category').default('standard'),
    year: integer('year'),
    licensePlate: varchar('license_plate', { length: 20 }),
    color: varchar('color', { length: 50 }),
    image: text('image').notNull(),
    gallery: json('gallery').$type(),
    price: decimal('price', { precision: 12, scale: 2 }).notNull(),
    maxPrice: decimal('max_price', { precision: 12, scale: 2 }),
    capacity: integer('capacity').notNull(),
    transmission: transmissionEnum('transmission').notNull(),
    fuel: fuelEnum('fuel').default('Bensin'),
    description: text('description'),
    features: json('features').$type(),
    status: carStatusEnum('status').default('available'),
    availableCount: integer('available_count').default(1),
    isDemo: boolean('is_demo').notNull().default(false),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const customers = pgTable('customers', {
    id: serial('id').primaryKey(),
    // Links this customer record back to the logged-in user that owns it.
    // Populated when a client books their own order. NULL for legacy customers
    // imported via Rekap — those rows are not "owned" by any single user.
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 255 }).notNull(),
    companyName: varchar('company_name', { length: 255 }),
    email: varchar('email', { length: 255 }).unique(),
    phone: varchar('phone', { length: 50 }),
    whatsapp: varchar('whatsapp', { length: 50 }),
    customerType: customerTypeEnum('customer_type').default('private'),
    job: varchar('job', { length: 255 }),
    address: text('address'),
    status: customerStatusEnum('status').default('active'),
    notes: text('notes'),
    totalOrders: integer('total_orders').default(0),
    lastOrderDate: timestamp('last_order_date'),
    isDemo: boolean('is_demo').notNull().default(false),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Company directory ─────────────────────────────────────────────────
// Dedicated address book for invoice/penawaran/perjanjian recipients.
// Separate from `customers` (which mixes private renters and ad-hoc
// company entries) so this table stays clean — one row per company,
// with the canonical billing address.
export const companies = pgTable('companies', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull().unique(),
    address: text('address'),
    phone: varchar('phone', { length: 50 }),
    email: varchar('email', { length: 255 }),
    notes: text('notes'),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const drivers = pgTable('drivers', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 50 }).notNull(),
    licenseNumber: varchar('license_number', { length: 50 }),
    licenseExpiry: timestamp('license_expiry'),
    licenseDocUrl: text('license_doc_url'),
    idCardUrl: text('id_card_url'),
    photoUrl: text('photo_url'),
    status: driverStatusEnum('status').default('active'),
    address: text('address'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const orders = pgTable('orders', {
    id: serial('id').primaryKey(),
    // orderNumber is the BOOKING identifier, NOT the per-car identifier.
    // Multi-car bookings (Tier 2) write N order rows that all share the
    // same orderNumber — the "trip code" customers reference. The DB
    // UNIQUE constraint was dropped (see orders_shared_code_migration.sql)
    // and a non-unique index added for lookup performance. Code generation
    // is centralized in services/order-code.service.js so duplicates only
    // happen intentionally (multi-car bookings), never by accident.
    orderNumber: varchar('order_number', { length: 20 }).notNull(),
    carId: integer('car_id').references(() => cars.id, { onDelete: 'set null' }),
    customerId: integer('customer_id').references(() => customers.id).notNull(),
    driverId: integer('driver_id').references(() => drivers.id),
    pickupDate: timestamp('pickup_date').notNull(),
    returnDate: timestamp('return_date').notNull(),
    pickupLocation: text('pickup_location'),
    totalDays: integer('total_days').notNull(),
    dailyRate: decimal('daily_rate', { precision: 12, scale: 2 }).notNull(),
    totalPrice: decimal('total_price', { precision: 12, scale: 2 }).notNull(),
    status: orderStatusEnum('status').default('pending'),
    notes: text('notes'),
    // Additional Rekap Order fields
    package: varchar('package', { length: 50 }),
    destination: varchar('destination', { length: 255 }),
    overnightNights: integer('overnight_nights').default(0),
    overtimeHours: decimal('overtime_hours', { precision: 5, scale: 2 }).default('0'),
    bailout: decimal('bailout', { precision: 12, scale: 2 }).default('0'),
    whatsappSent: boolean('whatsapp_sent').default(false),
    approvedBy: text('approved_by').references(() => user.id),
    approvedAt: timestamp('approved_at'),
    // Invoice / billing fields — populated from Logbook sheet during Rekap sync,
    // or set manually when generating an invoice from the Dokumen page.
    invoiceNumber: varchar('invoice_number', { length: 50 }),       // "26/DSR/INV/C001"
    invoiceLetterNumber: varchar('invoice_letter_number', { length: 50 }), // "No.26/DSR/052"
    invoiceSentDate: timestamp('invoice_sent_date'),                // Tanggal Kirim
    invoiceDueDate: timestamp('invoice_due_date'),                  // Due Date
    invoicePaidDate: timestamp('invoice_paid_date'),                // Tanggal Realisasi
    invoicePaymentStatus: varchar('invoice_payment_status', { length: 20 }), // Pending / Paid
    // Origin tracking — distinguishes web-created orders from Excel-synced ones
    sourceOrigin: varchar('source_origin', { length: 20 }).default('web'), // 'web' | 'rekap_xlsx'
    isDemo: boolean('is_demo').notNull().default(false),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Rekap Sync Logs ────────────────────────────────────────────────
// Audit trail for periodic Rekap 2026.xlsx → DB syncs (and manual triggers).
// Row per sync attempt — success or failure both recorded.
export const syncLogs = pgTable('sync_logs', {
    id: serial('id').primaryKey(),
    source: varchar('source', { length: 50 }).notNull(),    // 'rekap_xlsx' | 'gdrive' | etc.
    trigger: varchar('trigger', { length: 20 }).notNull(),  // 'manual' | 'scheduled' | 'upload'
    status: varchar('status', { length: 20 }).notNull(),    // 'success' | 'partial' | 'failed'
    filePath: text('file_path'),
    fileSize: integer('file_size'),
    rowsRead: integer('rows_read').default(0),
    customersInserted: integer('customers_inserted').default(0),
    customersUpdated: integer('customers_updated').default(0),
    driversInserted: integer('drivers_inserted').default(0),
    driversUpdated: integer('drivers_updated').default(0),
    carsInserted: integer('cars_inserted').default(0),
    carsUpdated: integer('cars_updated').default(0),
    ordersInserted: integer('orders_inserted').default(0),
    ordersUpdated: integer('orders_updated').default(0),
    errors: json('errors'), // array of {row, kodeTransaksi, message}
    durationMs: integer('duration_ms'),
    triggeredBy: text('triggered_by').references(() => user.id),
    createdAt: timestamp('created_at').defaultNow(),
});

export const maintenance = pgTable('maintenance', {
    id: serial('id').primaryKey(),
    carId: integer('car_id').references(() => cars.id, { onDelete: 'cascade' }).notNull(),
    type: maintenanceTypeEnum('type').notNull(),
    description: text('description'),
    scheduledDate: timestamp('scheduled_date').notNull(),
    completedDate: timestamp('completed_date'),
    cost: decimal('cost', { precision: 12, scale: 2 }),
    notes: text('notes'),
    status: maintenanceStatusEnum('status').default('scheduled'),
    isDemo: boolean('is_demo').notNull().default(false),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
});

export const activityLogs = pgTable('activity_logs', {
    id: serial('id').primaryKey(),
    userId: text('user_id').references(() => user.id),
    action: activityActionEnum('action').notNull(),
    entity: varchar('entity', { length: 100 }).notNull(),
    entityId: varchar('entity_id', { length: 100 }),
    details: json('details'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at').defaultNow(),
});

export const dashboardPrefs = pgTable('dashboard_prefs', {
    id: serial('id').primaryKey(),
    userId: text('user_id').references(() => user.id).notNull().unique(),
    widgetConfig: json('widget_config').$type().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const reviews = pgTable('reviews', {
    id: serial('id').primaryKey(),
    customerId: integer('customer_id').references(() => customers.id).notNull(),
    orderId: integer('order_id').references(() => orders.id),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    isDemo: boolean('is_demo').notNull().default(false),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
});

// ─── Financial Reports ──────────────────────────────────────────────
export const financialReports = pgTable('financial_reports', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    category: finCategoryEnum('category').notNull(),
    period: varchar('period', { length: 100 }),
    status: finStatusEnum('status').default('draft'),
    fileUrl: text('file_url'),
    fileType: varchar('file_type', { length: 20 }),
    notes: text('notes'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Journal Entries (core financial data) ──────────────────────────
export const journalEntries = pgTable('journal_entries', {
    id: serial('id').primaryKey(),
    entryDate: timestamp('entry_date').notNull(),
    month: integer('month'),
    description: varchar('description', { length: 500 }).notNull(),
    category: varchar('category', { length: 100 }).notNull(),
    debit: decimal('debit', { precision: 15, scale: 2 }).default('0'),
    credit: decimal('credit', { precision: 15, scale: 2 }).default('0'),
    reference: varchar('reference', { length: 100 }),
    batchId: varchar('batch_id', { length: 50 }),
    journalRef: varchar('journal_ref', { length: 20 }),      // e.g. JU-2026-0001
    isReversal: boolean('is_reversal').default(false),
    reversalOf: integer('reversal_of'),                       // FK to self (added in migration)
    isDemo: boolean('is_demo').notNull().default(false),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
});

// ─── Chart of Accounts ──────────────────────────────────────────────
export const chartOfAccounts = pgTable('chart_of_accounts', {
    id: serial('id').primaryKey(),
    code: varchar('code', { length: 20 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    type: varchar('type', { length: 20 }).notNull(),          // asset|liability|equity|income|expense
    normalBalance: varchar('normal_balance', { length: 10 }).notNull(), // debit|credit
    description: text('description'),
    isActive: boolean('is_active').default(true),
    isDemo: boolean('is_demo').notNull().default(false),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Locked Periods ─────────────────────────────────────────────────
export const lockedPeriods = pgTable('locked_periods', {
    id: serial('id').primaryKey(),
    year: integer('year').notNull(),
    month: integer('month'),                                  // NULL = entire year locked
    lockedBy: text('locked_by').references(() => user.id),
    lockedAt: timestamp('locked_at').defaultNow(),
});

// ─── Access Requests (Phase 3) ──────────────────────────────────────
// A user requests access to a feature their role doesn't grant.
// Admins approve/reject; on approve we flip the user.permissions JSON.
export const accessRequests = pgTable('access_requests', {
    id: serial('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    featureKey: varchar('feature_key', { length: 50 }).notNull(),
    status: accessRequestStatusEnum('status').notNull().default('pending'),
    note: text('note'),
    requestedAt: timestamp('requested_at').notNull().defaultNow(),
    decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at'),
});
