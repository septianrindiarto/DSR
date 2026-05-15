import { Router } from 'express';
import { orderService } from '../services/order.service.js';
import { customerService } from '../services/customer.service.js';
import { carService } from '../services/car.service.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { activityLogger } from '../middleware/logger.js';
import { logActivity } from '../middleware/logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

const router = Router();

const publicOrderSchema = z.object({
    carId: z.number().int(),
    fullName: z.string().min(1, 'Nama wajib diisi'),
    whatsapp: z.string().min(1, 'WhatsApp wajib diisi'),
    pickupDate: z.string().min(1, 'Tanggal mulai wajib diisi'),
    returnDate: z.string().min(1, 'Tanggal selesai wajib diisi'),
    pickupLocation: z.string().optional(),
    notes: z.string().optional(),
});

// Public: create order from booking form
router.post('/public', validate(publicOrderSchema), async (req, res, next) => {
    try {
        const { carId, fullName, whatsapp, pickupDate, returnDate, pickupLocation, notes } = req.body;

        // Find or create customer
        const customer = await customerService.findOrCreate({
            name: fullName,
            phone: whatsapp,
            whatsapp: whatsapp,
        });

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
        });
        res.json(result);
    } catch (error) { next(error); }
});

router.get('/stats', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const stats = await orderService.getStats();
        res.json(stats);
    } catch (error) { next(error); }
});

router.get('/:id', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const order = await orderService.findById(parseInt(req.params.id));
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
        res.json(order);
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
