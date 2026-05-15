import { Router } from 'express';
import { orderService } from '../services/order.service.js';
import { customerService } from '../services/customer.service.js';
import { carService } from '../services/car.service.js';
import { driverService } from '../services/driver.service.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { activityLogger } from '../middleware/logger.js';
import { logActivity } from '../middleware/logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { db } from '../db/index.js';
import { orders, customers, drivers, cars } from '../db/schema.js';
import { like, sql } from 'drizzle-orm';

const router = Router();

const publicOrderSchema = z.object({
    carId: z.number().int(),
    fullName: z.string().min(1, 'Nama wajib diisi'),
    whatsapp: z.string().min(1, 'WhatsApp wajib diisi'),
    customerType: z.enum(['private', 'company']).optional().default('private'),
    companyName: z.string().nullable().optional(),
    pickupDate: z.string().min(1, 'Tanggal mulai wajib diisi'),
    returnDate: z.string().min(1, 'Tanggal selesai wajib diisi'),
    pickupLocation: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    // Extra Rekap Order fields — captured on the booking form so the saved
    // order matches every column shown in Rekap Order.
    package: z.string().nullable().optional(),
    destination: z.string().nullable().optional(),
    overnightNights: z.union([z.string(), z.number()]).optional(),
    overtimeHours: z.union([z.string(), z.number()]).optional(),
    bailout: z.union([z.string(), z.number()]).optional(),
}).refine(
    (data) => data.customerType !== 'company' || (data.companyName && data.companyName.trim().length > 0),
    { message: 'Nama perusahaan wajib diisi untuk pemesanan perusahaan', path: ['companyName'] }
);

// Public: create order from booking form
router.post('/public', validate(publicOrderSchema), async (req, res, next) => {
    try {
        const {
            carId, fullName, whatsapp, customerType, companyName,
            pickupDate, returnDate, pickupLocation, notes,
            package: pkg, destination, overnightNights, overtimeHours, bailout,
        } = req.body;

        // Find or create customer (with type / company info)
        let customer = await customerService.findOrCreate({
            name: fullName,
            phone: whatsapp,
            whatsapp: whatsapp,
            customerType: customerType || 'private',
            companyName: companyName || null,
        });

        // If existing customer was missing type/companyName info or it changed, patch it
        const needsTypeUpdate = customerType && customer.customerType !== customerType;
        const needsCompanyUpdate = (customerType === 'company') && companyName && customer.companyName !== companyName;
        if (customer && (needsTypeUpdate || needsCompanyUpdate)) {
            customer = await customerService.update(customer.id, {
                customerType: customerType || customer.customerType,
                companyName: customerType === 'company' ? (companyName || customer.companyName) : customer.companyName,
            });
        }

        // Get car to calculate price
        const car = await carService.findById(carId);
        if (!car) return res.status(404).json({ error: 'Mobil tidak ditemukan' });

        // Calculate days and price
        const start = new Date(pickupDate);
        const end = new Date(returnDate);
        const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        if (totalDays <= 0) return res.status(400).json({ error: 'Tanggal tidak valid' });

        const dailyRate = Number(car.price);
        const totalPrice = dailyRate * totalDays;

        const order = await orderService.create({
            carId,
            customerId: customer.id,
            pickupDate: start,
            returnDate: end,
            pickupLocation: pickupLocation || null,
            totalDays,
            dailyRate: String(dailyRate),
            totalPrice: String(totalPrice),
            notes: notes || null,
            // Extra Rekap Order fields persisted directly from the booking form
            package: pkg || null,
            destination: destination || null,
            overnightNights: Number(overnightNights || 0),
            overtimeHours: String(Number(overtimeHours || 0)),
            bailout: String(Number(bailout || 0)),
        });

        // Log activity
        await logActivity({
            action: 'create',
            entity: 'order',
            entityId: order.id,
            details: { customerName: fullName, carName: car.name, orderNumber: order.orderNumber },
        });

        res.status(201).json({
            success: true,
            message: 'Pesanan berhasil dikirim! Admin akan menghubungi Anda via WhatsApp untuk konfirmasi.',
            order: {
                orderNumber: order.orderNumber,
                totalDays,
                totalPrice: `Rp ${totalPrice.toLocaleString('id-ID')}`,
            },
        });
    } catch (error) { next(error); }
});

// Admin routes
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
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

router.get('/:id', requireAuth, requireAdmin, async (req, res, next) => {
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

        // Dates
        const now = new Date();
        const pickupDate = body.pickupDate ? new Date(body.pickupDate) : now;
        const returnDate = body.returnDate ? new Date(body.returnDate) : pickupDate;
        const diffDays = Math.max(1, Math.ceil((returnDate - pickupDate) / 86400000) + 1);
        const totalDays = Number(body.totalDays) || diffDays;
        const totalPrice = Number(body.totalPrice || 0);
        const dailyRate = body.dailyRate !== undefined
            ? Number(body.dailyRate)
            : (totalDays > 0 ? totalPrice / totalDays : totalPrice);

        const order = await orderService.create({
            carId: body.carId || null,
            customerId: customer.id,
            driverId: body.driverId || null,
            pickupDate,
            returnDate,
            pickupLocation: body.pickupLocation || null,
            totalDays,
            dailyRate: String(dailyRate),
            totalPrice: String(totalPrice),
            status: body.status || 'pending',
            notes: body.notes || null,
            package: body.package || null,
            destination: body.destination || null,
            overnightNights: Number(body.overnightNights || 0),
            overtimeHours: String(Number(body.overtimeHours || 0)),
            bailout: String(Number(body.bailout || 0)),
            organizationId: req.user.organizationId || null,
            createdBy: req.user.id,
            isDemo: req.user.isDemo || false,
        });

        res.status(201).json(order);
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

// ─── Delete order ─────────────────────────────────────────────────────
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
        const order = await orderService.findById(parseInt(req.params.id));
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });

        const confirmation = whatsappService.buildConfirmationMessage(order);
        await orderService.markWhatsAppSent(order.id);

        await logActivity({
            userId: req.user.id,
            action: 'confirm',
            entity: 'order',
            entityId: order.id,
            details: { orderNumber: order.orderNumber, action: 'whatsapp_confirmation_sent' },
        });

        res.json(confirmation);
    } catch (error) { next(error); }
});

export default router;
