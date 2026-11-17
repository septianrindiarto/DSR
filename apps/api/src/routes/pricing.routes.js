// ─── /api/pricing — rate cards, city zones, corporate rates, quotes ─────────
// Config endpoints are agency-only (pricing.view / pricing.edit) and always
// act on the caller's own agency. /quote is public (optionalAuth): who sees
// which agency's prices is decided in pricingService.quote().
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { activityLogger } from '../middleware/logger.js';
import { requirePerm } from '../middleware/permission.js';
import { pricingService } from '../services/pricing.service.js';
import { companyScope } from '../services/company.service.js';
import { resolveDefaultAgencyId } from '../services/relationship.service.js';

const router = Router();

const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, res)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
};

// Caller's agency (agency accounts; superadmin → home agency).
async function agencyOf(req, res, next) {
    try {
        const u = req.user;
        if (u.role === 'superadmin') req.agencyId = u.organizationId || await resolveDefaultAgencyId();
        else if (u.accountType === 'agency' && u.organizationId) req.agencyId = u.organizationId;
        if (!req.agencyId) return res.status(403).json({ error: 'Hanya untuk akun agency.' });
        next();
    } catch (e) { next(e); }
}

// Client company must be one of this agency's clients.
async function clientInScope(req, res, next) {
    try {
        const id = Number(req.params.clientOrgId);
        const [row] = await db.select({ id: organizations.id }).from(organizations)
            .where(and(eq(organizations.id, id), ...companyScope(req.user))).limit(1);
        if (!row) return res.status(404).json({ error: 'Perusahaan tidak ditemukan.' });
        next();
    } catch (e) { next(e); }
}

const money = z.union([z.number(), z.string()]).nullable().optional();
const itemSchema = z.object({
    category: z.string().max(40).nullable().optional(),
    package: z.string().max(40).nullable().optional(),
    quantity: z.number().int().min(1).max(10).optional(),
    destination: z.string().max(255).nullable().optional(),
    zone: z.number().int().min(1).max(4).nullable().optional(),
    carModel: z.string().max(150).nullable().optional(),
    carPrice: money,
    overtimeHours: money,
    overnightNights: money,
});
const quoteSchema = z.object({
    items: z.array(itemSchema).min(1).max(10),
    pickupDate: z.string().min(1),
    returnDate: z.string().min(1),
    clientOrgId: z.number().int().nullable().optional(),
    agencyId: z.number().int().nullable().optional(),
});

// Public / any user — literal path, registered first.
router.post('/quote', optionalAuth, validate(quoteSchema), wrap((req) => pricingService.quote(req.user || null, req.body)));
router.get('/meta', wrap(() => pricingService.meta()));

router.use(requireAuth, agencyOf);

router.get('/config', requirePerm('pricing', 'view'), wrap((req) => pricingService.getConfig(req.agencyId)));

router.put('/rate-cards', requirePerm('pricing', 'edit'),
    validate(z.object({ rows: z.array(z.object({ category: z.string(), package: z.string(), zone: z.number().int(), carModel: z.string().max(100).nullable().optional(), pricePerDay: money })).max(2000) })),
    activityLogger('update', 'rate_cards'), wrap((req) => pricingService.saveRateCards(req.agencyId, req.body.rows, req.user.id)));

router.put('/zones', requirePerm('pricing', 'edit'),
    validate(z.object({ cities: z.array(z.object({ city: z.string().max(100), zone: z.number().int() })).max(2000) })),
    activityLogger('update', 'zone_cities'), wrap((req) => pricingService.saveZones(req.agencyId, req.body.cities)));

router.put('/settings', requirePerm('pricing', 'edit'),
    validate(z.object({ overtimePerHour: money, overnightPerNight: money, rounding: z.number().int().optional(), publicPrices: z.boolean().optional(), defaultZone: z.number().int().nullable().optional() })),
    activityLogger('update', 'pricing_settings'), wrap((req) => pricingService.saveSettings(req.agencyId, req.body)));

router.get('/corporate/:clientOrgId', requirePerm('pricing', 'view'), clientInScope, wrap((req) => pricingService.getCorporate(req.agencyId, req.params.clientOrgId)));
router.put('/corporate/:clientOrgId', requirePerm('pricing', 'edit'), clientInScope,
    validate(z.object({ rates: z.array(z.object({ category: z.string(), package: z.string(), zone: z.number().int().optional(), pricePerDay: money, discountPct: money, validUntil: z.string().nullable().optional() })).max(500) })),
    activityLogger('update', 'corporate_rates'), wrap((req) => pricingService.saveCorporate(req.agencyId, req.params.clientOrgId, req.body.rates, req.user.id)));

export default router;
