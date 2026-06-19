// notifications.routes.js
//
// Internal endpoints for managing the admin-facing notification channels.
// Right now only Telegram is wired up. The endpoints are admin-only.
//
//   GET  /api/notifications/telegram/status  - { configured, chatIdCount }
//   POST /api/notifications/telegram/test    - sends a test message

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { notifyAdmin, isTelegramConfigured } from '../services/telegram.service.js';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/telegram/status', (req, res) => {
    const configured = isTelegramConfigured();
    const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_ID || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    res.json({
        configured,
        chatIdCount: chatIds.length,
    });
});

router.post('/telegram/test', async (req, res) => {
    if (!isTelegramConfigured()) {
        return res.status(400).json({
            ok: false,
            error: 'Telegram belum dikonfigurasi. Atur TELEGRAM_BOT_TOKEN dan TELEGRAM_ADMIN_CHAT_ID di .env.',
        });
    }

    const text = [
        '✅ <b>Test notifikasi DSR Solution</b>',
        '',
        `Dikirim oleh: ${req.user?.name || req.user?.email || 'admin'}`,
        `Waktu: ${new Date().toLocaleString('id-ID')}`,
        '',
        'Jika Anda menerima pesan ini, integrasi Telegram berfungsi.',
    ].join('\n');

    const result = await notifyAdmin(text);
    if (result.ok) {
        return res.json({
            ok: true,
            message: `Test terkirim ke ${result.results.length} chat.`,
            results: result.results,
        });
    }
    return res.status(502).json({
        ok: false,
        error: 'Gagal mengirim test. Cek token dan chat id.',
        results: result.results || [],
        reason: result.reason,
    });
});

export default router;
