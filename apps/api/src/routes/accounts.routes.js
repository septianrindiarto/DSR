import { Router } from 'express';
import { accountsService } from '../services/accounts.service.js';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try { res.json(await accountsService.list()); } catch (e) { next(e); }
});

router.get('/:id', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const a = await accountsService.get(Number(req.params.id));
        if (!a) return res.status(404).json({ error: 'Akun tidak ditemukan' });
        res.json(a);
    } catch (e) { next(e); }
});

router.post('/', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const { code, name, type, normalBalance, description } = req.body;
        if (!code || !name || !type || !normalBalance) return res.status(400).json({ error: 'Kode, nama, tipe, dan saldo normal wajib diisi.' });
        res.status(201).json(await accountsService.create({ code, name, type, normalBalance, description }));
    } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try { res.json(await accountsService.update(Number(req.params.id), req.body)); } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try { res.json(await accountsService.delete(Number(req.params.id))); } catch (e) { next(e); }
});

export default router;
