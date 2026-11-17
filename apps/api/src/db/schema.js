import { pgTable, text, varchar, integer, smallint, serial, boolean, timestamp, date, decimal, json, jsonb, pgEnum } from 'drizzle-orm/pg-core';

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
export const activityActionEnum = pgEnum('activity_action', ['create', 'update', 'delete', 'login', 'logout', 'approve', 'reject', 'confirm', 'view', 'export']);
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
    npwp: text('npwp'),                 // AES-256-GCM encrypted (crypto.service)
    notes: text('notes'),
    // Phase 4C-1 — display_id is the human-readable org identifier
    // (e.g. "DRC_20260614"). UNIQUE; generated at registration. parent_agency_id
    // links a client org to its owning agency (NULL for agency orgs themselves).
    displayId: varchar('display_id', { length: 20 }),
    parentAgencyId: integer('parent_agency_id'),
    // Stage 2 — per-agency join code; clients enter it (registration / Pengaturan)
    // to link to this agency.
    agencyCode: varchar('agency_code', { length: 20 }),
    // Document numbering prefixes (Pengaturan → Penomoran Dokumen), stored per
    // org so invoice/surat numbers are shared across devices/users instead of
    // living only in each browser's localStorage. Shape: { yearPrefix,
    // invoicePrefix, letterPrefix, kwitansiPrefix, penawaranPrefix,
    // perjanjianPrefix, suratJalanPrefix }.
    docNumbering: jsonb('doc_numbering'),
    // Payment term in days. Client org = that client's term; agency org = the
    // default term. Due date = invoice sent date + term (invoice.service).
    paymentTermDays: integer('payment_term_days'),
    // Pricing engine settings (agency) + corporate portal settings (client).
    pricingSettings: jsonb('pricing_settings'),
    fleetOptions: jsonb('fleet_options'),         // { types: [...] } vehicle types (fleet-core.js)
    corporateSettings: jsonb('corporate_settings'),
    // RBAC v2 — template for new members; agency legal onboarding.
    defaultTemplate: varchar('default_template', { length: 60 }),
    legalStatus: varchar('legal_status', { length: 12 }).notNull().default('active'), // active | setup
    taxProfile: jsonb('tax_profile'),              // agency default tax treatment (tax-core.js)
    opsPolicyDefault: jsonb('ops_policy_default'), // agency default lembur & perjalanan dinas matrix
    legalDocs: jsonb('legal_docs'),   // { nib, akta, npwp, ktp } → { url, number?, uploadedAt }
    nib: text('nib'),                   // AES-256-GCM encrypted (crypto.service)
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
    // RBAC v2 (rbac_migration.sql): template + per-user grants/revokes of
    // 'feature.action' keys. template_key NULL = derived from role+accountType.
    templateKey: varchar('template_key', { length: 60 }),
    permGrants: jsonb('perm_grants').default([]),
    permRevokes: jsonb('perm_revokes').default([]),
    // Stage 2 — per-agent affiliate code; public /?ref=<code> ties a private
    // order to this agent's agency.
    affiliateCode: varchar('affiliate_code', { length: 20 }),
    // Better Auth twoFactor plugin (two_factor_migration.sql).
    twoFactorEnabled: boolean('two_factor_enabled').default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Better Auth twoFactor plugin — TOTP secret + backup codes (both encrypted
// by Better Auth with BETTER_AUTH_SECRET). Model name must be `twoFactor`.
export const twoFactor = pgTable('two_factor', {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until'),
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
    // Session lock / idle timeout (zz_session_lock_migration.sql). Not a Better Auth field.
    lastSeenAt: timestamp('last_seen_at').defaultNow(),
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
    type: varchar('type', { length: 40 }).notNull(),   // agency's own list (organizations.fleet_options) — was enum car_type
    category: carCategoryEnum('category').default('standard'),
    year: integer('year'),
    licensePlate: varchar('license_plate', { length: 20 }),
    isOwned: boolean('is_owned').notNull().default(false),   // company-owned unit (Analytics)
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
    // Fleet care (contracts_fleetcare_migration.sql): documents & service plan.
    stnkExpiry: date('stnk_expiry', { mode: 'string' }),
    taxExpiry: date('tax_expiry', { mode: 'string' }),          // pajak tahunan
    kirExpiry: date('kir_expiry', { mode: 'string' }),
    insuranceExpiry: date('insurance_expiry', { mode: 'string' }),
    currentOdometer: integer('current_odometer'),
    odometerUpdatedAt: timestamp('odometer_updated_at'),
    serviceIntervalKm: integer('service_interval_km'),
    serviceIntervalMonths: smallint('service_interval_months'),
    lastServiceKm: integer('last_service_km'),
    lastServiceDate: date('last_service_date', { mode: 'string' }),
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
    licenseNumber: text('license_number'), // SIM number — AES-256-GCM encrypted
    licenseExpiry: timestamp('license_expiry'),
    joinDate: date('join_date', { mode: 'string' }),   // tanggal bergabung (driver_join_date_migration.sql)
    employmentType: varchar('employment_type', { length: 12 }), // employee|freelance (ops_recap_migration.sql)
    licenseDocUrl: text('license_doc_url'),
    idCardUrl: text('id_card_url'),
    photoUrl: text('photo_url'),
    status: driverStatusEnum('status').default('active'),
    address: text('address'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    // Driver app login (phase_bc_migration.sql).
    userId: text('user_id'),
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
    // Snapshot of the exact "Nama" typed in the booking/Rekap form. The order
    // is the storehouse for the form; this preserves the entered name verbatim
    // regardless of how customer_id is deduped. Display prefers this column.
    customerName: varchar('customer_name', { length: 255 }),
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
    // Link to the invoice record (source of truth). The invoice* columns above
    // are a denormalized read copy kept in sync by invoice.service.
    invoiceId: integer('invoice_id'),
    // Stage 2 — order claim model. claim_status: unclaimed | client_claimed | agency_claimed
    claimedByUserId: text('claimed_by_user_id'),
    claimedByAgencyId: integer('claimed_by_agency_id'),
    contractId: integer('contract_id'),   // M / L / R rows → their contract
    claimStatus: varchar('claim_status', { length: 20 }).default('unclaimed'),
    // Corporate portal (pricing_corporate_migration.sql): division / cost
    // centre, and the CLIENT's internal approval (separate from approvedBy,
    // which is the agency confirming the order). While waiting, claim_status
    // = 'awaiting_approval' so no agency sees or claims it.
    costCenter: varchar('cost_center', { length: 100 }),
    clientApprovalStatus: varchar('client_approval_status', { length: 12 }), // waiting | approved | rejected
    clientApprovedBy: text('client_approved_by'),
    clientApprovedAt: timestamp('client_approved_at'),
    clientApprovalNote: varchar('client_approval_note', { length: 500 }),
    // Pricing engine: how total_price was computed (corporate | rate_card | car) + zone used.
    priceSource: varchar('price_source', { length: 20 }),
    priceZone: smallint('price_zone'),
    // Claim SLA (phase_bc_migration.sql): when an agency took it + reminders sent.
    claimedAt: timestamp('claimed_at'),
    claimReminderCount: integer('claim_reminder_count').notNull().default(0),
    lastClaimReminderAt: timestamp('last_claim_reminder_at'),
    // Origin tracking — distinguishes web-created orders from Excel-synced ones
    sourceOrigin: varchar('source_origin', { length: 20 }).default('web'), // 'web' | 'rekap_xlsx'
    isDemo: boolean('is_demo').notNull().default(false),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Invoices (D.2) ─────────────────────────────────────────────────
// One row per issued invoice; a group invoice links many order rows via
// orders.invoice_id. invoice_number is stable across cancel & re-issue
// (partial unique index on non-cancelled rows — see invoices_migration.sql).
export const invoices = pgTable('invoices', {
    id: serial('id').primaryKey(),
    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
    organizationId: integer('organization_id'),   // owning agency
    clientOrgId: integer('client_org_id'),         // company directory record (terms)
    companyName: varchar('company_name', { length: 255 }),
    letterNumber: varchar('letter_number', { length: 50 }),
    sentDate: timestamp('sent_date'),
    dueDate: timestamp('due_date'),
    paidDate: timestamp('paid_date'),
    paymentTermDays: integer('payment_term_days'), // term frozen at issue time
    totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    paidAmount: decimal('paid_amount', { precision: 15, scale: 2 }).notNull().default('0'), // Σ invoice_payments
    isCancelled: boolean('is_cancelled').notNull().default(false),
    cancelledAt: timestamp('cancelled_at'),
    cancelReason: text('cancel_reason'),
    cancelledBy: text('cancelled_by'),   // zz_notifications_migration.sql
    cancelledMeta: jsonb('cancelled_meta'),   // { codes, contractIds, orderIds } snapshot at cancel
    replacesInvoiceId: integer('replaces_invoice_id'),
    // Tax breakdown (zz_tax_faktur_migration.sql) — identical to the faktur pajak.
    subtotal: decimal('subtotal', { precision: 15, scale: 2 }),
    discountAmount: decimal('discount_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    dpp: decimal('dpp', { precision: 15, scale: 2 }),
    dppOther: decimal('dpp_other', { precision: 15, scale: 2 }),
    ppnAmount: decimal('ppn_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    pphMode: varchar('pph_mode', { length: 10 }).notNull().default('none'),
    pphRate: decimal('pph_rate', { precision: 5, scale: 2 }),
    pphAmount: decimal('pph_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    taxProfile: jsonb('tax_profile'),
    fakturId: integer('faktur_id'),
    contractId: integer('contract_id'),
    notes: text('notes'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Invoice payments (partial payments, #10) ───────────────────────
export const invoicePayments = pgTable('invoice_payments', {
    id: serial('id').primaryKey(),
    invoiceId: integer('invoice_id').notNull(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    paidDate: timestamp('paid_date').notNull(),
    isFinal: boolean('is_final').notNull().default(false), // "pelunasan" — settles the invoice
    accountId: integer('account_id'), // Kas/Bank that received it (Books auto-posting)
    kind: varchar('kind', { length: 10 }).notNull().default('cash'),  // cash | pph23 (withheld by the client)
    withholdingRef: varchar('withholding_ref', { length: 80 }),       // no. bukti potong
    note: text('note'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
});

// ─── Faktur pajak (one = one or more invoices, same buyer & masa) ───
export const fakturPajak = pgTable('faktur_pajak', {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    clientOrgId: integer('client_org_id'),
    buyerName: varchar('buyer_name', { length: 255 }),
    buyerNpwp: varchar('buyer_npwp', { length: 40 }),
    buyerAddress: text('buyer_address'),
    masa: varchar('masa', { length: 7 }).notNull(),
    kind: varchar('kind', { length: 10 }).notNull().default('tunggal'),
    nsfp: varchar('nsfp', { length: 40 }),
    fakturDate: date('faktur_date', { mode: 'string' }),
    status: varchar('status', { length: 12 }).notNull().default('draft'),
    replacesId: integer('replaces_id'),
    dpp: decimal('dpp', { precision: 15, scale: 2 }).notNull().default('0'),
    dppOther: decimal('dpp_other', { precision: 15, scale: 2 }).notNull().default('0'),
    ppnAmount: decimal('ppn_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    taxProfile: jsonb('tax_profile'),
    fileRef: text('file_ref'),
    fileName: varchar('file_name', { length: 200 }),
    notes: text('notes'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Client ↔ Agency links (Stage 2, many-to-many) ──────────────────
// A client company can be served by several agencies and vice-versa.
// status: active | pending (awaiting client approval) | archived.
export const clientAgencyLinks = pgTable('client_agency_links', {
    id: serial('id').primaryKey(),
    clientOrgId: integer('client_org_id').notNull(),
    agencyOrgId: integer('agency_org_id').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    approvalToken: varchar('approval_token', { length: 64 }), // set when status='pending'
    taxProfile: jsonb('tax_profile'),   // how THIS agency bills THIS client (overrides the agency default)
    createdAt: timestamp('created_at').notNull().defaultNow(),
    createdBy: text('created_by'),
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
    odometer: integer('odometer'),   // km at the service (fleet care)
    endDate: timestamp('end_date'),  // planned finish (zz_fleet_events_migration.sql)
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
    agencyOrgId: integer('agency_org_id'),   // agency being rated (phase C)
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
    code: varchar('code', { length: 20 }).notNull(),   // unique per organization (books_migration.sql)
    name: varchar('name', { length: 255 }).notNull(),
    type: varchar('type', { length: 20 }).notNull(),          // asset|liability|equity|income|expense
    normalBalance: varchar('normal_balance', { length: 10 }).notNull(), // debit|credit
    isCash: boolean('is_cash').notNull().default(false),        // Kas / Bank → drives Arus Kas
    cashFlowClass: varchar('cash_flow_class', { length: 20 }),  // operating|investing|financing
    description: text('description'),
    isActive: boolean('is_active').default(true),
    isDemo: boolean('is_demo').notNull().default(false),
    organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── RBAC v2 (rbac_migration.sql) ───────────────────────────────────
export const permissionTemplates = pgTable('permission_templates', {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    accountType: varchar('account_type', { length: 20 }).notNull(),
    permissions: jsonb('permissions').notNull().default([]),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const permissionAudit = pgTable('permission_audit', {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id'),
    actorId: text('actor_id'),
    targetUserId: text('target_user_id'),
    targetTemplateId: integer('target_template_id'),
    action: varchar('action', { length: 40 }).notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at').defaultNow(),
});

// ─── Books v2 (double-entry journal, see books_migration.sql) ────────
export const bookTransactions = pgTable('book_transactions', {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    journalNo: varchar('journal_no', { length: 30 }).notNull(),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    description: varchar('description', { length: 500 }).notNull(),
    reference: varchar('reference', { length: 100 }),
    source: varchar('source', { length: 20 }).notNull().default('manual'), // manual|cashbook|template|import|opening|reversal
    status: varchar('status', { length: 12 }).notNull().default('draft'),  // draft|posted|reversed
    reversalOf: integer('reversal_of'),
    batchId: varchar('batch_id', { length: 50 }),
    totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    // Auto-posting link (books_autopost_migration.sql): source='auto' entries
    // point at the business record that produced them (invoice | payment).
    sourceType: varchar('source_type', { length: 20 }),
    sourceId: integer('source_id'),
    createdBy: text('created_by'),
    postedBy: text('posted_by'),
    postedAt: timestamp('posted_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const bookLines = pgTable('book_lines', {
    id: serial('id').primaryKey(),
    transactionId: integer('transaction_id').notNull(),
    lineNo: integer('line_no').notNull().default(1),
    accountId: integer('account_id').notNull(),
    debit: decimal('debit', { precision: 15, scale: 2 }).notNull().default('0'),
    credit: decimal('credit', { precision: 15, scale: 2 }).notNull().default('0'),
    memo: varchar('memo', { length: 300 }),
    orderNumber: varchar('order_number', { length: 20 }),
    carId: integer('car_id'),
});

export const bookImportMappings = pgTable('book_import_mappings', {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    label: varchar('label', { length: 200 }).notNull(),
    direction: varchar('direction', { length: 3 }).notNull(), // in|out
    accountId: integer('account_id').notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const bookPeriodLocks = pgTable('book_period_locks', {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    year: integer('year').notNull(),
    month: integer('month').notNull(),
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at').defaultNow(),
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

// ─── Pricing engine (pricing_corporate_migration.sql) ───────────────
export const rateCards = pgTable('rate_cards', {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    package: varchar('package', { length: 20 }).notNull(),
    zone: smallint('zone').notNull(),
    carModel: varchar('car_model', { length: 100 }).notNull().default(''),
    pricePerDay: decimal('price_per_day', { precision: 12, scale: 2 }).notNull(),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const zoneCities = pgTable('zone_cities', {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    city: varchar('city', { length: 100 }).notNull(),
    cityNorm: varchar('city_norm', { length: 100 }).notNull(),
    zone: smallint('zone').notNull(),
});

export const corporateRates = pgTable('corporate_rates', {
    id: serial('id').primaryKey(),
    agencyOrgId: integer('agency_org_id').notNull(),
    clientOrgId: integer('client_org_id').notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    package: varchar('package', { length: 20 }).notNull(),
    zone: smallint('zone').notNull().default(0),   // 0 = all zones
    pricePerDay: decimal('price_per_day', { precision: 12, scale: 2 }),
    discountPct: decimal('discount_pct', { precision: 5, scale: 2 }),
    validUntil: date('valid_until', { mode: 'string' }),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Corporate portal ───────────────────────────────────────────────
export const costCenters = pgTable('cost_centers', {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    code: varchar('code', { length: 30 }),
    name: varchar('name', { length: 100 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow(),
});

// ─── Phase B: online payment links (Xendit) ─────────────────────────
export const paymentLinks = pgTable('payment_links', {
    id: serial('id').primaryKey(),
    invoiceId: integer('invoice_id').notNull(),
    organizationId: integer('organization_id'),
    provider: varchar('provider', { length: 20 }).notNull().default('xendit'),
    externalId: varchar('external_id', { length: 100 }).notNull(),
    providerId: varchar('provider_id', { length: 100 }),
    url: text('url'),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    status: varchar('status', { length: 12 }).notNull().default('pending'), // pending|paid|expired|cancelled
    expiresAt: timestamp('expires_at'),
    paidAt: timestamp('paid_at'),
    paidAmount: decimal('paid_amount', { precision: 15, scale: 2 }),
    channel: varchar('channel', { length: 60 }),
    paymentId: integer('payment_id'),
    raw: jsonb('raw'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Phase B: driver app ────────────────────────────────────────────
export const driverTrips = pgTable('driver_trips', {
    id: serial('id').primaryKey(),
    orderId: integer('order_id').notNull(),
    driverId: integer('driver_id').notNull(),
    organizationId: integer('organization_id'),
    status: varchar('status', { length: 12 }).notNull().default('started'), // started|finished
    startedAt: timestamp('started_at').notNull().defaultNow(),
    startOdometer: integer('start_odometer'),
    startFuel: smallint('start_fuel'),
    startPhotos: jsonb('start_photos'),
    startLat: decimal('start_lat', { precision: 10, scale: 7 }),
    startLng: decimal('start_lng', { precision: 10, scale: 7 }),
    endedAt: timestamp('ended_at'),
    endOdometer: integer('end_odometer'),
    endFuel: smallint('end_fuel'),
    endPhotos: jsonb('end_photos'),
    endLat: decimal('end_lat', { precision: 10, scale: 7 }),
    endLng: decimal('end_lng', { precision: 10, scale: 7 }),
    overtimeHoursSuggested: decimal('overtime_hours_suggested', { precision: 5, scale: 2 }),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow(),
});

export const driverExpenses = pgTable('driver_expenses', {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id'),
    driverId: integer('driver_id').notNull(),
    orderId: integer('order_id'),
    carId: integer('car_id'),
    type: varchar('type', { length: 20 }).notNull(),     // bbm|tol|parkir|lainnya
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    spentAt: timestamp('spent_at').notNull().defaultNow(),
    receipt: text('receipt'),
    note: varchar('note', { length: 300 }),
    bookTransactionId: integer('book_transaction_id'),
    createdAt: timestamp('created_at').defaultNow(),
});

// ─── Long-term contracts (contracts_fleetcare_migration.sql) ────────
export const leaseContracts = pgTable('lease_contracts', {
    id: serial('id').primaryKey(),
    agencyOrgId: integer('agency_org_id').notNull(),
    clientOrgId: integer('client_org_id').notNull(),
    contractNumber: varchar('contract_number', { length: 40 }).notNull(),
    title: varchar('title', { length: 200 }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    billingDay: smallint('billing_day'),               // nullable: required only to approve
    kmAllowanceMonth: integer('km_allowance_month'),
    excessKmRate: decimal('excess_km_rate', { precision: 12, scale: 2 }),
    includes: jsonb('includes'),          // { driver, fuel, maintenance, insurance, replacement }
    package: varchar('package', { length: 40 }),
    // Rekap Operasional & Lembur (ops_recap_migration.sql)
    extrasMode: varchar('extras_mode', { length: 10 }).notNull().default('none'), // included|separate|none
    cutoffDay: smallint('cutoff_day'),                 // 1–28, null = end of month
    workStart: varchar('work_start', { length: 5 }),
    workEnd: varchar('work_end', { length: 5 }),
    opsPolicy: jsonb('ops_policy'),                  // overtime & SPPD policy (ops_forms_migration.sql)
    status: varchar('status', { length: 12 }).notNull().default('draft'), // draft|active|ended|terminated
    amendsContractId: integer('amends_contract_id'),   // amendment of this contract (zz_contract_monthly_amend)
    amendmentNo: smallint('amendment_no'),
    supersededBy: integer('superseded_by'),            // stopped and replaced by this amendment
    notes: text('notes'),
    remindersSent: jsonb('reminders_sent'),
    // Contract workflow (contracts_workflow_migration.sql): who created it and
    // both sides' approval of the current terms (any change clears both).
    createdSide: varchar('created_side', { length: 10 }).notNull().default('agency'),
    agencyApprovedAt: timestamp('agency_approved_at'),
    agencyApprovedBy: text('agency_approved_by'),
    clientApprovedAt: timestamp('client_approved_at'),
    clientApprovedBy: text('client_approved_by'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// A document one side requires from the other before a contract can start.
export const contractDocuments = pgTable('contract_documents', {
    id: serial('id').primaryKey(),
    contractId: integer('contract_id').notNull(),
    requiredFrom: varchar('required_from', { length: 10 }).notNull(), // agency | client (who uploads)
    title: varchar('title', { length: 150 }).notNull(),
    note: text('note'),
    mandatory: boolean('mandatory').notNull().default(true),
    dueDate: date('due_date', { mode: 'string' }),
    status: varchar('status', { length: 12 }).notNull().default('pending'), // pending|uploaded|approved|rejected
    fileRef: text('file_ref'),
    fileName: varchar('file_name', { length: 200 }),
    reviewNote: text('review_note'),
    uploadedBy: text('uploaded_by'),
    uploadedAt: timestamp('uploaded_at'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});
export const leaseContractUnits = pgTable('lease_contract_units', {
    id: serial('id').primaryKey(),
    contractId: integer('contract_id').notNull(),
    carId: integer('car_id'),
    driverId: integer('driver_id'),
    monthlyFee: decimal('monthly_fee', { precision: 12, scale: 2 }).notNull(),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    notes: varchar('notes', { length: 300 }),
});

export const leaseBillings = pgTable('lease_billings', {
    id: serial('id').primaryKey(),
    contractId: integer('contract_id').notNull(),
    period: varchar('period', { length: 7 }).notNull(),
    invoiceId: integer('invoice_id'),
    orderNumber: varchar('order_number', { length: 20 }),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull().default('0'),
    detail: jsonb('detail'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
});

// One M code per contract × unit × month (zz_contract_monthly_amend_migration.sql)
export const leaseUnitBillings = pgTable('lease_unit_billings', {
    id: serial('id').primaryKey(),
    contractId: integer('contract_id').notNull(),
    unitId: integer('unit_id').notNull(),
    period: varchar('period', { length: 7 }).notNull(),
    monthIndex: integer('month_index').notNull().default(1),
    orderId: integer('order_id'),
    orderNumber: varchar('order_number', { length: 20 }),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull().default('0'),
    detail: jsonb('detail'),
    // Monthly M detail form (zz_monthly_form_migration.sql): open → submitted → approved | rejected
    status: varchar('status', { length: 12 }).notNull().default('open'),
    kmStart: integer('km_start'),
    kmEnd: integer('km_end'),
    kmSegments: jsonb('km_segments'),   // [{ key, role, carId, from, to, kmStart, kmEnd }]
    picName: varchar('pic_name', { length: 120 }),
    destination: varchar('destination', { length: 200 }),
    note: text('note'),
    evidence: jsonb('evidence').notNull().default([]),
    comments: jsonb('comments').notNull().default([]),
    submittedAt: timestamp('submitted_at'),
    submittedBy: text('submitted_by'),
    agencyApprovedAt: timestamp('agency_approved_at'),
    agencyApprovedBy: text('agency_approved_by'),
    clientApprovedAt: timestamp('client_approved_at'),
    clientApprovedBy: text('client_approved_by'),
    rejectReason: varchar('reject_reason', { length: 300 }),
    updatedBy: text('updated_by'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Rekap Operasional & Lembur (ops_recap_migration.sql) ───────────
export const opsRecaps = pgTable('ops_recaps', {
    id: serial('id').primaryKey(),
    code: varchar('code', { length: 12 }).notNull(),           // R001…
    contractId: integer('contract_id').notNull(),
    agencyOrgId: integer('agency_org_id').notNull(),
    clientOrgId: integer('client_org_id').notNull(),
    period: varchar('period', { length: 7 }).notNull(),
    kind: varchar('kind', { length: 10 }).notNull(),           // overtime|expense
    dateFrom: date('date_from', { mode: 'string' }).notNull(),
    dateTo: date('date_to', { mode: 'string' }).notNull(),
    status: varchar('status', { length: 12 }).notNull().default('waiting'), // waiting|approved|invoiced|cancelled
    entryCount: integer('entry_count').notNull().default(0),
    totalHours: decimal('total_hours', { precision: 8, scale: 2 }).notNull().default('0'),
    totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    submittedAt: timestamp('submitted_at').defaultNow(),
    reminders: jsonb('reminders'),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at'),
    invoiceId: integer('invoice_id'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const opsEntries = pgTable('ops_entries', {
    id: serial('id').primaryKey(),
    agencyOrgId: integer('agency_org_id').notNull(),
    clientOrgId: integer('client_org_id').notNull(),
    contractId: integer('contract_id').notNull(),
    contractUnitId: integer('contract_unit_id'),
    carId: integer('car_id'),
    driverId: integer('driver_id'),
    kind: varchar('kind', { length: 10 }).notNull(),           // overtime|expense|trip
    type: varchar('type', { length: 16 }).notNull(),           // lembur|bbm|tol|parkir|penginapan|makan|lainnya
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    startTime: varchar('start_time', { length: 5 }),
    endTime: varchar('end_time', { length: 5 }),
    dayType: varchar('day_type', { length: 10 }).notNull().default('workday'), // workday|restday|holiday
    hours: decimal('hours', { precision: 6, scale: 2 }),
    amount: decimal('amount', { precision: 14, scale: 2 }),
    note: varchar('note', { length: 500 }),
    evidence: jsonb('evidence').notNull().default([]),        // [{ ref, name, type, at }]
    detail: jsonb('detail'),                                  // SPKL rows / SPPD legs + calc snapshot
    comments: jsonb('comments').notNull().default([]),        // [{ at, by, side, text }] feedback thread
    source: varchar('source', { length: 10 }).notNull(),       // driver|agency|client|import
    status: varchar('status', { length: 12 }).notNull().default('submitted'), // submitted|verified|in_recap|approved|rejected|billed
    billable: boolean('billable').notNull().default(true),
    rejectReason: varchar('reject_reason', { length: 300 }),
    recapId: integer('recap_id'),
    // One code per form (ops_z_form_codes_migration.sql): L### lembur, R### operasional.
    code: varchar('code', { length: 12 }),
    agencyApprovedAt: timestamp('agency_approved_at'),
    agencyApprovedBy: text('agency_approved_by'),
    clientApprovedAt: timestamp('client_approved_at'),
    clientApprovedBy: text('client_approved_by'),
    invoiceId: integer('invoice_id'),
    createdBy: text('created_by'),
    verifiedBy: text('verified_by'),
    verifiedAt: timestamp('verified_at'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const holidays = pgTable('holidays', {
    id: serial('id').primaryKey(),
    date: date('date', { mode: 'string' }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    organizationId: integer('organization_id'),               // null = national holiday
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
});

export const odometerReadings = pgTable('odometer_readings', {
    id: serial('id').primaryKey(),
    carId: integer('car_id').notNull(),
    readingDate: timestamp('reading_date').notNull().defaultNow(),
    km: integer('km').notNull(),
    source: varchar('source', { length: 12 }).notNull().default('manual'), // manual|trip|service
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
});

export const jobRuns = pgTable('job_runs', {
    jobKey: varchar('job_key', { length: 80 }).primaryKey(),
    lastRunAt: timestamp('last_run_at').notNull(),
    detail: jsonb('detail'),
});

// ─── In-app notifications (zz_notifications_migration.sql) ──────────
// Audience = organization_id (+ optional perm, + optional single user).
export const notifications = pgTable('notifications', {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id'),
    userId: text('user_id'),
    perm: varchar('perm', { length: 60 }),
    kind: varchar('kind', { length: 30 }).notNull(),
    severity: varchar('severity', { length: 10 }).notNull().default('info'),   // info | warning | urgent
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body'),
    link: varchar('link', { length: 300 }),
    ref: varchar('ref', { length: 60 }),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
});
export const notificationReads = pgTable('notification_reads', {
    notificationId: integer('notification_id').notNull(),
    userId: text('user_id').notNull(),
    readAt: timestamp('read_at').defaultNow(),
});

// ─── Replacement units + emergency reports (zz_fleet_events_migration.sql) ─
export const leaseUnitReplacements = pgTable('lease_unit_replacements', {
    id: serial('id').primaryKey(),
    contractId: integer('contract_id').notNull(),
    contractUnitId: integer('contract_unit_id').notNull(),
    originalCarId: integer('original_car_id'),
    replacementCarId: integer('replacement_car_id').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    reason: varchar('reason', { length: 20 }).notNull().default('maintenance'),   // maintenance | emergency | other
    note: varchar('note', { length: 300 }),
    maintenanceId: integer('maintenance_id'),
    incidentId: integer('incident_id'),
    status: varchar('status', { length: 10 }).notNull().default('active'),       // active | ended
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
    endedAt: timestamp('ended_at'),
    endedBy: text('ended_by'),
});
export const unitIncidents = pgTable('unit_incidents', {
    id: serial('id').primaryKey(),
    carId: integer('car_id').notNull(),
    organizationId: integer('organization_id'),
    contractId: integer('contract_id'),
    contractUnitId: integer('contract_unit_id'),
    kind: varchar('kind', { length: 20 }).notNull().default('breakdown'),        // breakdown | accident | tire | other
    severity: varchar('severity', { length: 10 }).notNull().default('urgent'),
    description: text('description').notNull(),
    location: varchar('location', { length: 200 }),
    offRoad: boolean('off_road').notNull().default(false),
    status: varchar('status', { length: 10 }).notNull().default('open'),        // open | resolved
    reportedBy: text('reported_by'),
    reportedAt: timestamp('reported_at').defaultNow(),
    resolution: text('resolution'),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at'),
});

// ─── Why a browser's session ended (zz_session_lock_migration.sql) ──
export const sessionEnds = pgTable('session_ends', {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    userId: text('user_id'),
    reason: varchar('reason', { length: 12 }).notNull(),   // expired | kicked
    device: varchar('device', { length: 80 }),
    at: timestamp('at').defaultNow(),
});
