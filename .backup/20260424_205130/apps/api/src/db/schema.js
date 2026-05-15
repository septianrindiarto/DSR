import { pgTable, text, varchar, integer, serial, boolean, timestamp, decimal, json, pgEnum } from 'drizzle-orm/pg-core';

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
export const userRoleEnum = pgEnum('user_role', ['admin', 'superadmin']);

// ─── Better Auth Tables ──────────────────────────────────────────────
export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: userRoleEnum('role').default('admin'),
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
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const customers = pgTable('customers', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
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
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const orders = pgTable('orders', {
    id: serial('id').primaryKey(),
    orderNumber: varchar('order_number', { length: 20 }).notNull().unique(),
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
    whatsappSent: boolean('whatsapp_sent').default(false),
    approvedBy: text('approved_by').references(() => user.id),
    approvedAt: timestamp('approved_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
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
    createdAt: timestamp('created_at').defaultNow(),
});