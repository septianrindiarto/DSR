import { Router } from 'express';
import { orderService, generateOrderNumber } from '../services/order.service.js';
import { customerService } from '../services/customer.service.js';
import { carService } from '../services/car.service.js';
import { driverService } from '../services/driver.service.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { notifyOrderCreated, notifyOrderClaimed } from '../services/telegram.service.js';
import { relationshipService } from '../services/relationship.service.js';
import { requireAuth, requireAdmin, requireRole, optionalAuth } from '../middleware/auth.js';
import { ROLE_GROUPS } from '../services/permissions.service.js';
import { activityLogger } from '../middleware/logger.js';
import { logActivity } from '../middleware/logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { db } from '../db/index.js';
import { orders, customers, drivers, cars, organizations } from '../db/schema.js';
import { like, sql } from 'drizzle-orm';

const router = Router();

// Per-vehicle row in a multi-car booking. Each row becomes one order
// record sharing the booking's orderNumber. Per-car add-ons (overnight,
// overtime, bailout, package) live here because they can differ per car
// even within the same trip (different destinations, different drivers).
const vehicleItemSchema = z.object({
    carId: z.number().int().nullable().optional(),
    carCategoryRequested: z.string().max(50).nullable().optional(),
    carCategoryNote: z.string().max(255).nullable().optional(),
    // Quantity > 1 expands this entry into N identical rows server-side.
    // Convenience for "I want 2 Avanzas" without forcing the form to
    // build [{MPV},{MPV}] explicitly. Max 10 per row as a sanity guard.
    quantity: z.number().int().min(1).max(10).optional().default(1),
    // Per-car package + add-ons. Default 0 / null when unset.
    package: z.string().nullable().optional(),
    overnightNights: z.union([z.string(), z.number()]).optional(),
    overtimeHours: z.union([z.string(), z.number()]).optional(),
    bailout: z.union([z.string(), z.number()]).optional(),
    // Per-car trip detail. Cars in one booking may split to different
    // destinations / pickup points, so these live on the vehicle row.
    // When omitted, the trip-level destination/pickupLocation is used as
    // a fallback (keeps older single-value clients working).
    destination: z.string().nullable().optional(),
    pickupLocation: z.string().nullable().optional(),
});

const publicOrderSchema = z.object({
    // Tier 2 multi-vehicle support — `vehicles` is the canonical shape.
    // Legacy single-car submissions (carId / carCategoryRequested at the
    // top level) are wrapped into a 1-element vehicles array inside the
    // handler. Both shapes produce identical DB state for a 1-car booking.
    vehicles: z.array(vehicleItemSchema).min(1).max(10).optional(),

    // Legacy single-car fields (kept for backward compatibility with any
    // client that hasn't migrated to vehicles[]). Ignored if vehicles[]
    // is present.
    carId: z.number().int().nullable().optional(),
    carCategoryRequested: z.string().max(50).nullable().optional(),
    carCategoryNote: z.string().max(255).nullable().optional(),
    package: z.string().nullable().optional(),
    overnightNights: z.union([z.string(), z.number()]).optional(),
    overtimeHours: z.union([z.string(), z.number()]).optional(),
    bailout: z.union([z.string(), z.number()]).optional(),

    // Trip-level fields — shared across all vehicles in the booking.
    fullName: z.string().min(1, 'Nama wajib diisi'),
    whatsapp: z.string().min(1, 'WhatsApp wajib diisi'),
    customerType: z.enum(['private', 'company']).optional().default('private'),
    companyName: z.string().nullable().optional(),
    pickupDate: z.string().min(1, 'Tanggal mulai wajib diisi'),
    returnDate: z.string().min(1, 'Tanggal selesai wajib diisi'),
    pickupLocation: z.string().nullable().optional(),
    destination: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    affiliateCode: z.string().nullable().optional(), // ?ref=<code> from the landing page
}).refine(
    (data) => data.customerType !== 'company' || (data.companyName && data.companyName.trim().length > 0),
    { message: 'Nama perusahaan wajib diisi untuk pemesanan perusahaan', path: ['companyName'] }
);

// Public: create order(s) from the booking form. Tier 2 multi-vehicle:
// if the payload includes a `vehicles` array, we generate ONE orderNumber
// and create N rows sharing it. Legacy single-vehicle payloads (no
// `vehicles`) are wrapped into a 1-element array transparently so this
// handler has a single code path.
router.post('/public', optionalAuth, validate(publicOrderSchema), async (req, res, next) => {
    try {
        const {
            fullName, whatsapp, customerType, companyName,
            pickupDate, returnDate, pickupLocation, destination, notes,
        } = req.body;

        // Normalise to a vehicles array. Either the client sent vehicles[]
        // directly, or we synthesise a 1-element array from the legacy
        // top-level fields. Either way, downstream logic only handles N>=1.
        const rawVehicles = Array.isArray(req.body.vehicles) && req.body.vehicles.length > 0
            ? req.body.vehicles
            : [{
                carId: req.body.carId || null,
                carCategoryRequested: req.body.carCategoryRequested || null,
                carCategoryNote: req.body.carCategoryNote || null,
                quantity: 1,
                package: req.body.package || null,
                overnightNights: req.body.overnightNights || 0,
                overtimeHours: req.body.overtimeHours || 0,
                bailout: req.body.bailout || 0,
                destination: req.body.destination || null,
                pickupLocation: req.body.pickupLocation || null,
            }];

        // Expand quantity > 1 into multiple identical rows. The form may send
        // {category: MPV, quantity: 2} as a convenience for "2 of this kind."
        // Cap at 10 per row in Zod; cap overall total at 10 as a sanity guard.
        const vehicles = [];
        for (const v of rawVehicles) {
            const qty = Math.max(1, Math.min(10, Number(v.quantity) || 1));
            for (let i = 0; i < qty; i++) vehicles.push({ ...v, quantity: 1 });
        }
        if (vehicles.length > 10) {
            return res.status(400).json({ error: 'Maksimal 10 kendaraan per pemesanan.' });
        }

        // Customer resolve / create (once per booking — all vehicles share)
        let customer = await customerService.findOrCreate({
            name: fullName,
            phone: whatsapp,
            whatsapp: whatsapp,
            customerType: customerType || 'private',
            companyName: companyName || null,
        });

        const needsTypeUpdate = customerType && customer.customerType !== customerType;
        const needsCompanyUpdate = (customerType === 'company') && companyName && customer.companyName !== companyName;
        if (customer && (needsTypeUpdate || needsCompanyUpdate)) {
            customer = await customerService.update(customer.id, {
                customerType: customerType || customer.customerType,
                companyName: customerType === 'company' ? (companyName || customer.companyName) : customer.companyName,
            });
        }

        // If the booking names a registered company, scope the order to that
        // company's organization so its admins see it in their Rekap (e.g. an
        // agency admin booking on behalf of "PT XYZ" via the dashboard
        // dropdown, or a public visitor who types a known company name). When
        // no org matches, organizationId stays null (agency-only visibility,
        // unchanged from before). We deliberately do NOT backfill
        // customers.user_id here — that linkage is reserved for the
        // authenticated admin "Tambah Rekap" path.
        let targetOrgId = null;
        if (companyName && companyName.trim()) {
            const needle = companyName.toLowerCase().trim();
            const [matchedOrg] = await db.select({ id: organizations.id })
                .from(organizations)
                .where(sql`LOWER(TRIM(${organizations.name})) = ${needle}`)
                .limit(1);
            if (matchedOrg) targetOrgId = matchedOrg.id;
        }

        // Initial ownership (the 3 rules + §10). An affiliate link wins; else
        // an agency creator owns it (Rule 3); else a client/anonymous order is
        // routed by its company's agency count (Rule 1 = exactly one agency
        // auto-claims; Rule 2 = 0 or many → left unclaimed for Klaim Order).
        let affiliateAgency = null;
        if (req.body.affiliateCode) {
            affiliateAgency = await relationshipService.resolveAffiliate(req.body.affiliateCode);
        }
        const claimFields = await orderService.resolveInitialClaim({
            user: req.user || null,
            targetOrgId,
            affiliateAgency,
        });

        // Dates (shared across all vehicles in the booking)
        const start = new Date(pickupDate);
        const end = new Date(returnDate);
        const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        if (totalDays <= 0) return res.status(400).json({ error: 'Tanggal tidak valid' });

        // ONE shared orderNumber for the whole booking. Tier 2 core: every
        // vehicle row in this booking writes the same code. The DB UNIQUE
        // constraint on order_number was dropped so duplicates are allowed.
        const sharedOrderNumber = await generateOrderNumber(customer.id);

        const createdOrders = [];
        let representativeCar = null;
        const carsById = new Map(); // carId -> car, for the Telegram per-row labels

        for (const v of vehicles) {
            let car = null;
            if (v.carId) {
                car = await carService.findById(v.carId);
                if (!car) return res.status(404).json({ error: 'Mobil tidak ditemukan' });
                if (!representativeCar) representativeCar = car;
                carsById.set(v.carId, car);
            }

            const dailyRate = car ? Number(car.price) : 0;
            const totalPrice = car ? dailyRate * totalDays : 0;

            // Per-car notes line: category prefix + trip notes (shared text).
            // Each row gets the same trip notes so the admin can read context
            // off any individual row in Rekap.
            const categoryLine = v.carCategoryRequested
                ? `Permintaan Kendaraan: ${v.carCategoryRequested}${v.carCategoryNote ? ` (${v.carCategoryNote})` : ''}`
                : '';
            const combinedNotes = [categoryLine, notes || ''].filter(Boolean).join('\n').trim() || null;

            // Per-car destination / pickup, falling back to the trip-level
            // values when a row didn't specify its own.
            const vehicleDestination = (v.destination ?? destination) || null;
            const vehiclePickup = (v.pickupLocation ?? pickupLocation) || null;

            const order = await orderService.create({
                orderNumber: sharedOrderNumber,
                carId: v.carId || null,
                customerId: customer.id,
                customerName: fullName, // exact "Nama" from the form
                pickupDate: start,
                returnDate: end,
                pickupLocation: vehiclePickup,
                totalDays,
                dailyRate: String(dailyRate),
                totalPrice: String(totalPrice),
                notes: combinedNotes,
                package: v.package || null,
                destination: vehicleDestination,
                overnightNights: Number(v.overnightNights || 0),
                overtimeHours: String(Number(v.overtimeHours || 0)),
                bailout: String(Number(v.bailout || 0)),
                organizationId: targetOrgId,
                // Who submitted it (when logged in) — lets a client's Rekap show
                // only their OWN submissions. Null for anonymous landing orders.
                createdBy: req.user?.id || null,
                ...claimFields,
            });
            createdOrders.push(order);
        }

        // Log activity ONCE per booking (not per vehicle row) so the activity
        // feed shows "PT Foo booked 3 vehicles (C073)" rather than 3 separate
        // create events with the same code.
        await logActivity({
            action: 'create',
            entity: 'order',
            entityId: createdOrders[0].id,
            details: {
                customerName: fullName,
                vehicleCount: createdOrders.length,
                orderNumber: sharedOrderNumber,
            },
        });

        // Telegram: ONE notification per booking, listing all N vehicles.
        // notifyOrderCreated accepts either a single order (legacy) or an
        // array. We pass the array; older notification code can fall back
        // to orders[0] if it hasn't been updated yet (Phase 6 hardens this).
        notifyOrderCreated({
            order: createdOrders[0],
            orders: createdOrders,
            car: representativeCar,
            carsById,
            customer,
            source: req.user ? 'dashboard' : 'landing',
            // Pre-expansion request so the alert reads "2 unit MPV / 1 unit SUV"
            // instead of N identical expanded rows.
            requestVehicles: rawVehicles,
        }).catch(() => { /* logged inside */ });

        const grandTotal = createdOrders.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0);

        res.status(201).json({
            success: true,
            message: vehicles.length === 1
                ? 'Pesanan berhasil dikirim! Admin akan menghubungi Anda via WhatsApp untuk konfirmasi.'
                : `Pesanan ${vehicles.length} kendaraan berhasil dikirim! Admin akan menghubungi Anda via WhatsApp untuk konfirmasi.`,
            order: {
                orderNumber: sharedOrderNumber,
                vehicleCount: createdOrders.length,
                totalDays,
                totalPrice: `Rp ${grandTotal.toLocaleString('id-ID')}`,
            },
            // Optional: expose individual row ids so the form can deep-link to each.
            vehicles: createdOrders.map(o => ({
                id: o.id,
                orderNumber: o.orderNumber,
                package: o.package,
            })),
        });
    } catch (error) { next(error); }
});

// List orders — accessible to ALL authenticated roles. Data scoping inside
// the handler (Task 16) filters down to "own orders only" for plain clients.
router.get('/', requireAuth, requireRole(ROLE_GROUPS.ANY_AUTHENTICATED), async (req, res, next) => {
    try {
        const { search, status, sortBy, sortOrder, page, limit } = req.query;
        const result = await orderService.findAll({
            search, status, sortBy, sortOrder,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 20,
            scopeUser: req.user,
        });
        res.json(result);
    } catch (error) { next(error); }
});

router.get('/stats', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const stats = await orderService.getStats(req.user);
        res.json(stats);
    } catch (error) { next(error); }
});

// Stage 2 — claimable bookings for the caller (unclaimed, in scope).
// Registered BEFORE `/:id` so the literal path isn't captured as an id.
router.get('/claimable', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const rows = await orderService.findClaimable(req.user);
        res.json({ data: rows, total: rows.length });
    } catch (error) { next(error); }
});

// ─── Export orders data as flattened JSON ─────────────────────────────
router.get('/data/export', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const all = await orderService.findAllRaw(req.user);
        const exportData = all.map((o, idx) => ({
            no: idx + 1,
            kodeTransaksi: o.orderNumber,
            nama: o.customer?.name || '',
            companyName: o.customer?.companyName || '',
            customerType: o.customer?.customerType || 'private',
            paket: o.package || '',
            tglPemakaian: o.pickupDate ? new Date(o.pickupDate).toISOString() : '',
            tglSelesai: o.returnDate ? new Date(o.returnDate).toISOString() : '',
            jumlahHari: o.totalDays,
            mobil: o.car ? `${o.car.brand || ''} ${o.car.name || ''}`.trim() : '',
            plat: o.car?.licensePlate || '',
            driver: o.driver?.name || '',
            kontrakHarga: Number(o.totalPrice || 0),
            tujuan: o.destination || '',
            inap: Number(o.overnightNights || 0),
            lembur: Number(o.overtimeHours || 0),
            status: o.status,
            bailout: Number(o.bailout || 0),
            notes: o.notes || '',
        }));
        res.setHeader('Content-Disposition', `attachment; filename=rekap-order-${Date.now()}.json`);
        res.json(exportData);
    } catch (error) { next(error); }
});

// ─── Import orders data from JSON ─────────────────────────────────────
router.post('/data/import', requireAuth, requireAdmin, activityLogger('create', 'order'), async (req, res, next) => {
    try {
        const items = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Data import harus berupa array dan tidak boleh kosong.' });
        }

        const orgId    = req.user.organizationId || null;
        const userId   = req.user.id;
        const isDemo   = req.user.isDemo || false;

        // ── Step 1: Pre-load all lookup tables in parallel (3 queries total) ──
        const [allCustomers, allCars, allDrivers] = await Promise.all([
            db.select({ id: customers.id, name: customers.name, companyName: customers.companyName, customerType: customers.customerType }).from(customers),
            db.select({ id: cars.id, licensePlate: cars.licensePlate }).from(cars),
            db.select({ id: drivers.id, name: drivers.name }).from(drivers),
        ]);

        const customerMap = new Map(allCustomers.map(c => [c.name.toLowerCase(), c]));
        const carMap      = new Map(allCars.filter(c => c.licensePlate).map(c => [c.licensePlate.toUpperCase(), c]));
        const driverMap   = new Map(allDrivers.map(d => [d.name.toLowerCase(), d]));

        // ── Step 2: Collect unique new customers and drivers needed ────────────
        const newCustomers = new Map(); // lowerName → insert values
        const newDrivers   = new Map(); // lowerName → insert values

        for (const item of items) {
            const customerName = (item.nama || item.customerName || '').trim();
            if (!customerName) continue;
            const lk = customerName.toLowerCase();
            if (!customerMap.has(lk) && !newCustomers.has(lk)) {
                const companyName   = item.companyName || item.company_name || null;
                const customerType  = (item.customerType || (companyName ? 'company' : 'private')).toLowerCase();
                newCustomers.set(lk, {
                    name: customerName, companyName, customerType,
                    phone: item.phone || item.whatsapp || null,
                    whatsapp: item.whatsapp || item.phone || null,
                    organizationId: orgId, createdBy: userId, isDemo,
                });
            }
            const driverName = String(item.driver || '').trim();
            const ld = driverName.toLowerCase();
            if (driverName && !driverMap.has(ld) && !newDrivers.has(ld)) {
                newDrivers.set(ld, {
                    name: driverName, phone: '0000000000', status: 'active',
                    organizationId: orgId, createdBy: userId, isDemo,
                });
            }
        }

        // ── Step 3: Batch-insert missing customers (1 query) ──────────────────
        // No conflict handling needed — we pre-screened against customerMap so
        // none of these names exist yet. Plain insert + returning is safer than
        // the onConflictDoNothing().returning() chain which requires a named target.
        if (newCustomers.size > 0) {
            const inserted = await db.insert(customers)
                .values([...newCustomers.values()])
                .returning({ id: customers.id, name: customers.name, customerType: customers.customerType });
            for (const c of inserted) customerMap.set(c.name.toLowerCase(), c);
        }

        // ── Step 4: Batch-insert missing drivers (1 query) ────────────────────
        if (newDrivers.size > 0) {
            const inserted = await db.insert(drivers)
                .values([...newDrivers.values()])
                .returning({ id: drivers.id, name: drivers.name });
            for (const d of inserted) driverMap.set(d.name.toLowerCase(), d);
        }

        // ── Step 5: Pre-fetch max order sequence numbers (2 parallel queries) ──
        const [pRows, cRows] = await Promise.all([
            db.select({ orderNumber: orders.orderNumber }).from(orders).where(like(orders.orderNumber, 'P%')),
            db.select({ orderNumber: orders.orderNumber }).from(orders).where(like(orders.orderNumber, 'C%')),
        ]);
        const maxSeq = (rows, prefix) => {
            let max = 0;
            for (const r of rows) {
                const m = new RegExp(`^${prefix}(\\d+)$`).exec(r.orderNumber || '');
                if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
            }
            return max;
        };
        let pSeq = maxSeq(pRows, 'P');
        let cSeq = maxSeq(cRows, 'C');

        // ── Step 6: Build all order rows in memory ────────────────────────────
        const orderRows  = [];
        const skippedErr = [];
        const custCounts = new Map(); // customerId → how many orders to add to total_orders

        for (const item of items) {
            try {
                const customerName = (item.nama || item.customerName || '').trim();
                if (!customerName) { skippedErr.push('Baris tanpa nama pelanggan dilewati'); continue; }

                const customer = customerMap.get(customerName.toLowerCase());
                if (!customer) { skippedErr.push(`Pelanggan tidak ditemukan: ${customerName}`); continue; }

                const driverName = String(item.driver || '').trim();
                const driver     = driverName ? driverMap.get(driverName.toLowerCase()) : null;
                const platKey    = String(item.plat || '').toUpperCase().trim();
                const car        = platKey ? carMap.get(platKey) : null;

                // Assign order number: keep provided kodeTransaksi, else auto-generate
                let orderNumber = (item.kodeTransaksi || '').trim();
                if (!orderNumber) {
                    const isCompany = customer.customerType === 'company';
                    orderNumber = isCompany
                        ? `C${String(++cSeq).padStart(3, '0')}`
                        : `P${String(++pSeq).padStart(3, '0')}`;
                }

                const pickupRaw  = item.pickupDate || item.tglPemakaian;
                const returnRaw  = item.returnDate  || item.tglSelesai;
                const _pd = pickupRaw ? new Date(pickupRaw) : null;
                const pickupDate = (_pd && !isNaN(_pd.getTime())) ? _pd : new Date();
                const _rd = returnRaw ? new Date(returnRaw) : null;
                const returnDate = (_rd && !isNaN(_rd.getTime()))
                    ? _rd
                    : new Date(pickupDate.getTime() + (Number(item.jumlahHari || 1) - 1) * 86400000);

                const totalDays  = Number(item.jumlahHari) || Math.max(1, Math.ceil((returnDate - pickupDate) / 86400000) + 1);
                const totalPrice = Number(item.kontrakHarga || 0);
                const dailyRate  = totalDays > 0 ? totalPrice / totalDays : totalPrice;

                orderRows.push({
                    orderNumber,
                    carId:          car?.id    || null,
                    customerId:     customer.id,
                    driverId:       driver?.id || null,
                    pickupDate, returnDate, totalDays,
                    dailyRate:      String(dailyRate),
                    totalPrice:     String(totalPrice),
                    package:        item.paket    || null,
                    destination:    item.tujuan   || null,
                    overnightNights: Number(item.inap    || 0),
                    overtimeHours:  String(Number(item.lembur  || 0)),
                    bailout:        String(Number(item.bailout || 0)),
                    status:         item.status   || 'pending',
                    notes:          item.notes    || null,
                    organizationId: orgId, createdBy: userId, isDemo,
                });

                custCounts.set(customer.id, (custCounts.get(customer.id) || 0) + 1);
            } catch (err) {
                skippedErr.push(err.message);
            }
        }

        // ── Step 7: Bulk-insert orders in chunks of 500 (≤1 query per 500 rows) ─
        let imported = 0;
        const CHUNK = 500;
        for (let i = 0; i < orderRows.length; i += CHUNK) {
            await db.insert(orders).values(orderRows.slice(i, i + CHUNK)).onConflictDoNothing();
            imported += Math.min(CHUNK, orderRows.length - i);
        }

        // ── Step 8: Bulk-update customer total_orders (parallel, 1 query/customer) ─
        if (custCounts.size > 0) {
            await Promise.all([...custCounts.entries()].map(([id, count]) =>
                db.execute(sql`
                    UPDATE customers
                    SET total_orders = total_orders + ${count},
                        last_order_date = NOW(),
                        updated_at = NOW()
                    WHERE id = ${id}
                `)
            ));
        }

        res.json({
            message: `Import selesai: ${imported} berhasil, ${skippedErr.length} dilewati.`,
            imported,
            skipped: skippedErr.length,
            errors:  skippedErr.slice(0, 20),
        });
    } catch (error) { next(error); }
});

// Single-order detail — accessible to all roles; ownership check inside the
// handler (Task 16) returns 404 if a plain client tries to read someone else's order.
router.get('/:id', requireAuth, requireRole(ROLE_GROUPS.ANY_AUTHENTICATED), async (req, res, next) => {
    try {
        const order = await orderService.findById(parseInt(req.params.id));
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        res.json(order);
    } catch (error) { next(error); }
});

// ─── Create order (admin) ─────────────────────────────────────────────
const createOrderSchema = z.object({
    carId: z.number().int().nullable().optional(),
    customerId: z.number().int().optional(),
    driverId: z.number().int().nullable().optional(),
    customerName: z.string().min(1, 'Nama pelanggan wajib diisi').optional(),
    companyName: z.string().nullable().optional(),
    customerType: z.string().optional(),
    customerPhone: z.string().nullable().optional(),
    customerEmail: z.string().nullable().optional(),
    pickupDate: z.string().optional(),
    returnDate: z.string().optional(),
    pickupLocation: z.string().nullable().optional(),
    totalDays: z.union([z.string(), z.number()]).optional(),
    dailyRate: z.union([z.string(), z.number()]).optional(),
    totalPrice: z.union([z.string(), z.number()]).optional(),
    status: z.string().optional(),
    notes: z.string().nullable().optional(),
    package: z.string().nullable().optional(),
    destination: z.string().nullable().optional(),
    overnightNights: z.union([z.string(), z.number()]).optional(),
    overtimeHours: z.union([z.string(), z.number()]).optional(),
    bailout: z.union([z.string(), z.number()]).optional(),
    // Tier 2 multi-vehicle: same shape as the public form's vehicles[].
    // When present, the legacy carId/package/overnight/overtime/bailout
    // top-level fields are IGNORED — the array is the source of truth.
    // Each vehicle row gets its own driverId so the admin can pre-assign
    // drivers from the same form. driverId at the top level is treated as
    // a fallback for legacy single-row submissions only.
    vehicles: z.array(z.object({
        carId: z.number().int().nullable().optional(),
        driverId: z.number().int().nullable().optional(),
        package: z.string().nullable().optional(),
        dailyRate: z.union([z.string(), z.number()]).optional(),
        totalPrice: z.union([z.string(), z.number()]).optional(),
        overnightNights: z.union([z.string(), z.number()]).optional(),
        overtimeHours: z.union([z.string(), z.number()]).optional(),
        bailout: z.union([z.string(), z.number()]).optional(),
        notes: z.string().nullable().optional(),
        // Per-car trip detail (falls back to the top-level values).
        destination: z.string().nullable().optional(),
        pickupLocation: z.string().nullable().optional(),
    })).min(1).max(10).optional(),
});

router.post('/', requireAuth, requireAdmin, validate(createOrderSchema), activityLogger('create', 'order'), async (req, res, next) => {
    try {
        const body = req.body;

        // Resolve customer: reuse by id, or find/create by name + phone
        let customer = null;
        if (body.customerId) {
            customer = await customerService.findById(body.customerId);
        } else if (body.customerName) {
            customer = await customerService.findOrCreate({
                name: body.customerName,
                companyName: body.companyName || null,
                customerType: body.customerType || (body.companyName ? 'company' : 'private'),
                phone: body.customerPhone || null,
                whatsapp: body.customerPhone || null,
                email: body.customerEmail || null,
            });
            // If existing customer was missing company info, update it
            if (customer && ((body.companyName && !customer.companyName) || (body.customerType && customer.customerType !== body.customerType))) {
                customer = await customerService.update(customer.id, {
                    companyName: body.companyName || customer.companyName,
                    customerType: body.customerType || customer.customerType,
                });
            }
        }
        if (!customer) return res.status(400).json({ error: 'Pelanggan wajib diisi' });

        // Resolve target org + user linkage for client-side visibility.
        //
        // When agency staff uses Tambah Rekap to book on behalf of a client
        // (e.g. DSR types "PT. XYZ"), the order MUST land in PT. XYZ's
        // org_id, not the agency's. Otherwise septian (PT. XYZ's admin)
        // never sees the order even though the scope check is correct.
        //
        // Same logic for customers.user_id: if the matched org has an
        // admin_user_id and the resolved customer row had no user link yet,
        // backfill it so the order also satisfies the customers.user_id
        // branch of the scope. This makes Tambah Rekap entries visible to
        // both client admins AND client users in that org.
        let targetOrgId = req.user.organizationId || null;
        if (body.companyName && body.companyName.trim()) {
            const needle = body.companyName.toLowerCase().trim();
            const [matchedOrg] = await db.select({
                id: organizations.id,
                adminUserId: organizations.adminUserId,
            })
                .from(organizations)
                .where(sql`LOWER(TRIM(${organizations.name})) = ${needle}`)
                .limit(1);
            if (matchedOrg) {
                targetOrgId = matchedOrg.id;
                if (!customer.userId && matchedOrg.adminUserId) {
                    try {
                        await customerService.update(customer.id, { userId: matchedOrg.adminUserId });
                        customer.userId = matchedOrg.adminUserId;
                    } catch (linkErr) {
                        console.warn('[orders.create] customer.user_id backfill failed:', linkErr?.message);
                    }
                }
            }
        }

        // Initial ownership (the 3 rules). An agency admin creating via Tambah
        // Rekap owns the order immediately (Rule 3). A client admin's order is
        // routed by its company's agency count (Rule 1 / Rule 2).
        const claimFields = await orderService.resolveInitialClaim({
            user: req.user,
            targetOrgId,
        });

        // Dates (shared across all vehicles in the booking)
        const now = new Date();
        const pickupDate = body.pickupDate ? new Date(body.pickupDate) : now;
        const returnDate = body.returnDate ? new Date(body.returnDate) : pickupDate;
        const diffDays = Math.max(1, Math.ceil((returnDate - pickupDate) / 86400000) + 1);
        const totalDays = Number(body.totalDays) || diffDays;

        // Tier 2 multi-vehicle: normalise to vehicles[] (1 element fallback
        // for legacy single-vehicle payloads). Same pattern as the public
        // endpoint above — single code path downstream.
        const vehicles = Array.isArray(body.vehicles) && body.vehicles.length > 0
            ? body.vehicles
            : [{
                carId: body.carId || null,
                driverId: body.driverId || null,
                package: body.package || null,
                dailyRate: body.dailyRate,
                totalPrice: body.totalPrice,
                overnightNights: body.overnightNights,
                overtimeHours: body.overtimeHours,
                bailout: body.bailout,
                notes: body.notes,
            }];
        if (vehicles.length > 10) {
            return res.status(400).json({ error: 'Maksimal 10 kendaraan per pemesanan.' });
        }

        // ONE shared orderNumber for the whole booking — Tier 2 core.
        const sharedOrderNumber = await generateOrderNumber(customer.id);

        const createdOrders = [];
        let representativeCar = null;
        const carsById = new Map(); // carId -> car, for the Telegram per-row labels

        for (const v of vehicles) {
            const vehiclePrice = Number(v.totalPrice || 0);
            const vehicleDailyRate = v.dailyRate !== undefined
                ? Number(v.dailyRate)
                : (totalDays > 0 ? vehiclePrice / totalDays : vehiclePrice);

            if (v.carId && !carsById.has(v.carId)) {
                const c = await carService.findById(v.carId).catch(() => null);
                if (c) {
                    carsById.set(v.carId, c);
                    if (!representativeCar) representativeCar = c;
                }
            }

            const order = await orderService.create({
                orderNumber: sharedOrderNumber,
                carId: v.carId || null,
                customerId: customer.id,
                customerName: body.customerName || customer.name, // exact form "Nama"
                driverId: v.driverId || null,
                pickupDate,
                returnDate,
                pickupLocation: (v.pickupLocation ?? body.pickupLocation) || null,
                totalDays,
                dailyRate: String(vehicleDailyRate),
                totalPrice: String(vehiclePrice),
                status: body.status || 'pending',
                notes: v.notes || body.notes || null,
                package: v.package || null,
                destination: (v.destination ?? body.destination) || null,
                overnightNights: Number(v.overnightNights || 0),
                overtimeHours: String(Number(v.overtimeHours || 0)),
                bailout: String(Number(v.bailout || 0)),
                organizationId: targetOrgId,
                createdBy: req.user.id,
                isDemo: req.user.isDemo || false,
                ...claimFields,
            });
            createdOrders.push(order);
        }

        // ONE Telegram notification per booking, listing all N vehicles.
        notifyOrderCreated({
            order: createdOrders[0],
            orders: createdOrders,
            car: representativeCar,
            carsById,
            customer,
            source: 'agency',
        }).catch(() => { /* logged inside */ });

        // For backward compat: if 1-vehicle booking, return the single order
        // shape clients are used to. For multi-vehicle, return the wrapper.
        if (createdOrders.length === 1) {
            return res.status(201).json(createdOrders[0]);
        }
        return res.status(201).json({
            orderNumber: sharedOrderNumber,
            vehicleCount: createdOrders.length,
            orders: createdOrders,
        });
    } catch (error) { next(error); }
});

// ─── Update order (edit) ──────────────────────────────────────────────
const updateOrderSchema = z.object({
    carId: z.number().int().nullable().optional(),
    customerId: z.number().int().optional(),
    driverId: z.number().int().nullable().optional(),
    pickupDate: z.string().optional(),
    returnDate: z.string().optional(),
    pickupLocation: z.string().nullable().optional(),
    totalDays: z.number().int().optional(),
    dailyRate: z.union([z.string(), z.number()]).optional(),
    totalPrice: z.union([z.string(), z.number()]).optional(),
    status: z.string().optional(),
    notes: z.string().nullable().optional(),
    package: z.string().nullable().optional(),
    destination: z.string().nullable().optional(),
    overnightNights: z.number().int().optional(),
    overtimeHours: z.union([z.string(), z.number()]).optional(),
    bailout: z.union([z.string(), z.number()]).optional(),
    // Customer-side edits (applied to the linked customer record)
    customerName: z.string().optional(),
    companyName: z.string().nullable().optional(),
    customerType: z.string().optional(),
    customerPhone: z.string().nullable().optional(),
});

// ─── Tier 2 multi-vehicle: bulk per-car driver assignment ─────────────
// Assign a driver to each car of a booking in one request. Registered
// BEFORE `/:id` so the literal path isn't captured as an order id.
const assignDriversSchema = z.object({
    assignments: z.array(z.object({
        orderId: z.number().int(),
        driverId: z.number().int().nullable().optional(),
    })).min(1).max(20),
});

router.put('/assign-drivers', requireAuth, requireAdmin, validate(assignDriversSchema), activityLogger('update', 'order'), async (req, res, next) => {
    try {
        const updated = await orderService.assignDriversBulk(req.body.assignments);
        res.json({ updated: updated.length, orders: updated });
    } catch (error) { next(error); }
});

// ─── Tier 2 multi-vehicle: bulk per-car FLEET-CAR assignment ──────────
// Assign an actual car (unit) to each row of a booking. Mirrors
// assign-drivers; price is recomputed for still-unpriced rows.
const assignCarsSchema = z.object({
    assignments: z.array(z.object({
        orderId: z.number().int(),
        carId: z.number().int().nullable().optional(),
    })).min(1).max(20),
});

router.put('/assign-cars', requireAuth, requireAdmin, validate(assignCarsSchema), activityLogger('update', 'order'), async (req, res, next) => {
    try {
        const updated = await orderService.assignCarsBulk(req.body.assignments);
        res.json({ updated: updated.length, orders: updated });
    } catch (error) { next(error); }
});

// ─── Tier 2 multi-vehicle: combined "Action" form — car + driver + price ──
// One request sets the unit, driver, and price for each row of a booking.
// Registered BEFORE `/:id` so the literal path isn't captured as an order id.
const bookingItemsSchema = z.object({
    items: z.array(z.object({
        orderId: z.number().int(),
        carId: z.number().int().nullable().optional(),
        driverId: z.number().int().nullable().optional(),
        totalPrice: z.union([z.string(), z.number()]).nullable().optional(),
    })).min(1).max(20),
});

router.put('/booking-items', requireAuth, requireAdmin, validate(bookingItemsSchema), activityLogger('update', 'order'), async (req, res, next) => {
    try {
        const updated = await orderService.updateBookingItemsBulk(req.body.items);
        res.json({ updated: updated.length, orders: updated });
    } catch (error) { next(error); }
});

// ─── Tier 2 multi-vehicle: cancel an entire booking by its order code ──
// Cancels every still-cancellable row sharing the code. Single-car cancel
// keeps using PUT /:id/status. 3-segment path → no clash with PUT /:id.
router.put('/booking/:orderNumber/cancel', requireAuth, requireAdmin, activityLogger('update', 'order'), async (req, res, next) => {
    try {
        const cancelled = await orderService.cancelByOrderNumber(req.params.orderNumber);
        if (!cancelled.length) {
            return res.status(404).json({ error: 'Booking tidak ditemukan atau sudah selesai/dibatalkan.' });
        }
        res.json({ cancelled: cancelled.length, orderNumber: req.params.orderNumber });
    } catch (error) { next(error); }
});

// ─── Stage 2: BULK claim several bookings at once (admin+ only) ───────
// 2-segment literal path — no clash with the 3-segment
// /booking/:orderNumber/claim or with /:id. Registered before them anyway.
const claimBulkSchema = z.object({
    orderNumbers: z.array(z.string().min(1)).min(1).max(2000),
});

router.put('/booking/claim-bulk', requireAuth, requireAdmin, validate(claimBulkSchema), activityLogger('update', 'order'), async (req, res, next) => {
    try {
        const summary = await orderService.claimManyByOrderNumber(req.body.orderNumbers, req.user);
        if (!summary.bookings) return res.status(404).json({ error: 'Tidak ada booking yang bisa diklaim.' });
        // ONE summary notification for the whole bulk action (firing one per
        // booking would mean hundreds of Telegram calls for a large claim).
        notifyOrderClaimed({
            orderNumber: `${summary.bookings} booking`,
            claimerName: req.user?.name || req.user?.email,
            claimerRole: req.user?.accountType === 'agency' ? 'agency' : 'client',
            vehicleCount: summary.vehicles,
        }).catch(() => { /* logged inside */ });
        res.json(summary);
    } catch (error) { next(error); }
});

// ─── Stage 2: claim / release an entire booking (admin+ only) ─────────
router.put('/booking/:orderNumber/claim', requireAuth, requireAdmin, activityLogger('update', 'order'), async (req, res, next) => {
    try {
        const claimed = await orderService.claimByOrderNumber(req.params.orderNumber, req.user);
        if (!claimed.length) return res.status(404).json({ error: 'Booking tidak ditemukan.' });
        notifyOrderClaimed({
            orderNumber: req.params.orderNumber,
            claimerName: req.user?.name || req.user?.email,
            claimerRole: req.user?.accountType === 'agency' ? 'agency' : 'client',
            vehicleCount: claimed.length,
        }).catch(() => { /* logged inside */ });
        res.json({ claimed: claimed.length, orderNumber: req.params.orderNumber });
    } catch (error) { next(error); }
});

router.put('/booking/:orderNumber/release', requireAuth, requireAdmin, activityLogger('update', 'order'), async (req, res, next) => {
    try {
        const released = await orderService.releaseByOrderNumber(req.params.orderNumber);
        if (!released.length) return res.status(404).json({ error: 'Booking tidak ditemukan.' });
        res.json({ released: released.length, orderNumber: req.params.orderNumber });
    } catch (error) { next(error); }
});

// ─── Tier 2 multi-vehicle: delete an entire booking (all rows by code) ──
router.delete('/booking/:orderNumber', requireAuth, requireAdmin, activityLogger('delete', 'order'), async (req, res, next) => {
    try {
        const removed = await orderService.removeByOrderNumber(req.params.orderNumber);
        if (!removed.length) return res.status(404).json({ error: 'Booking tidak ditemukan.' });
        res.json({ deleted: removed.length, orderNumber: req.params.orderNumber });
    } catch (error) { next(error); }
});

router.put('/:id', requireAuth, requireAdmin, validate(updateOrderSchema), activityLogger('update', 'order'), async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const existing = await orderService.findById(id);
        if (!existing) return res.status(404).json({ error: 'Order tidak ditemukan' });

        const body = req.body;
        const orderPatch = {};
        const directFields = ['carId', 'driverId', 'pickupLocation', 'totalDays', 'status', 'notes', 'package', 'destination', 'overnightNights'];
        for (const f of directFields) {
            if (body[f] !== undefined) orderPatch[f] = body[f];
        }
        if (body.pickupDate !== undefined) orderPatch.pickupDate = new Date(body.pickupDate);
        if (body.returnDate !== undefined) orderPatch.returnDate = new Date(body.returnDate);
        if (body.dailyRate !== undefined) orderPatch.dailyRate = String(body.dailyRate);
        if (body.totalPrice !== undefined) orderPatch.totalPrice = String(body.totalPrice);
        if (body.overtimeHours !== undefined) orderPatch.overtimeHours = String(body.overtimeHours);
        if (body.bailout !== undefined) orderPatch.bailout = String(body.bailout);

        // Update customer-side fields if they exist
        if (existing.customerId && (body.customerName !== undefined || body.companyName !== undefined || body.customerType !== undefined || body.customerPhone !== undefined)) {
            const cPatch = {};
            if (body.customerName !== undefined) cPatch.name = body.customerName;
            if (body.companyName !== undefined) cPatch.companyName = body.companyName;
            if (body.customerType !== undefined) cPatch.customerType = body.customerType;
            if (body.customerPhone !== undefined) { cPatch.phone = body.customerPhone; cPatch.whatsapp = body.customerPhone; }
            if (Object.keys(cPatch).length > 0) {
                await customerService.update(existing.customerId, cPatch);
            }
        }

        const updated = Object.keys(orderPatch).length > 0
            ? await orderService.update(id, orderPatch)
            : existing;

        res.json(updated);
    } catch (error) { next(error); }
});

// Delete order
router.delete('/:id', requireAuth, requireAdmin, activityLogger('delete', 'order'), async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const removed = await orderService.remove(id);
        if (!removed) return res.status(404).json({ error: 'Order tidak ditemukan' });
        res.json({ message: 'Order berhasil dihapus', data: removed });
    } catch (error) { next(error); }
});

router.put('/:id/status', requireAuth, requireAdmin, activityLogger('update', 'order'), async (req, res, next) => {
    try {
        const { status } = req.body;
        const order = await orderService.updateStatus(parseInt(req.params.id), status, req.user.id);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        res.json(order);
    } catch (error) { next(error); }
});

router.put('/:id/assign-driver', requireAuth, requireAdmin, activityLogger('update', 'order'), async (req, res, next) => {
    try {
        const { driverId } = req.body;
        const order = await orderService.assignDriver(parseInt(req.params.id), driverId);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        res.json(order);
    } catch (error) { next(error); }
});

router.post('/:id/send-confirmation', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const orderId = parseInt(req.params.id);
        const url = await whatsappService.buildConfirmationLink(orderId);
        if (!url) return res.status(404).json({ error: 'Order tidak ditemukan' });
        await orderService.markWhatsAppSent(orderId);
        res.json({ url });
    } catch (error) { next(error); }
});

export default router;
