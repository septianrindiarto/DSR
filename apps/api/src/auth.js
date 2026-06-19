import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db/index.js';
import { sendEmail } from './services/email.service.js';

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: 'pg',
    }),
    debug: process.env.DEBUG === 'true',
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 6,
        // Block sign-in until email_verified = true. Better Auth returns
        // a structured error the frontend can translate.
        requireEmailVerification: true,
    },
    emailVerification: {
        // Automatically send the verification email after signup so the
        // user gets it without a separate request.
        sendOnSignUp: true,
        // Token TTL — 24 hours is generous enough that the link survives
        // a sleep cycle but isn't usable forever if the inbox is breached.
        expiresIn: 60 * 60 * 24,
        async sendVerificationEmail({ user, token }) {
            // Build the link the user clicks. We route through OUR frontend
            // page (apps/web /verify-email), which then POSTs to Better Auth
            // — that gives us full control over the success/error UX.
            const appUrl = process.env.APP_URL || 'http://localhost:5173';
            const link = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
            // ALWAYS print the verification link to the API console. This is
            // the dev-mode safety net — if Resend can't deliver (unverified
            // domain, recipient outside Resend's free-tier allowlist, etc.)
            // the developer can copy the link from the terminal and complete
            // verification manually.
            console.log(`[auth] Verification link for ${user.email}:`);
            console.log(`        ${link}`);
            // Resilience: NEVER throw out of this callback. If Resend is not
            // yet configured (missing API key, network down, etc.) we still
            // want signup / login flows to complete.
            try {
            await sendEmail({
                to: user.email,
                subject: 'Verifikasi email Anda — DSR Solution',
                html: `<!doctype html>
<html><body style="font-family:Inter,Arial,sans-serif;background:#fcf8f8;padding:32px;">
  <table style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #eacdce;padding:32px;">
    <tr><td>
      <h1 style="color:#1d0c0d;font-size:22px;margin:0 0 8px;">Halo ${user.name || ''},</h1>
      <p style="color:#4a4a4a;font-size:14px;line-height:1.6;margin:0 0 20px;">
        Terima kasih sudah mendaftar di <b>DSR Solution</b>. Untuk mengaktifkan akun Anda,
        klik tombol di bawah ini.
      </p>
      <p style="margin:24px 0;">
        <a href="${link}" style="display:inline-block;background:#ff0008;color:#ffffff;
          text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">
          Aktifkan Akun Saya
        </a>
      </p>
      <p style="color:#888;font-size:12px;line-height:1.6;margin:0 0 8px;">
        Atau salin link berikut ke browser Anda:
      </p>
      <p style="color:#888;font-size:12px;word-break:break-all;margin:0 0 24px;">${link}</p>
      <hr style="border:none;border-top:1px solid #eacdce;margin:24px 0;">
      <p style="color:#a14548;font-size:12px;line-height:1.6;margin:0;">
        Link ini aktif selama 24 jam. Jika Anda tidak mendaftar, abaikan email ini.
      </p>
    </td></tr>
  </table>
</body></html>`,
                text:
                    `Halo ${user.name || ''},\n\n` +
                    `Terima kasih sudah mendaftar di DSR Solution. Aktifkan akun Anda dengan membuka link berikut:\n\n` +
                    `${link}\n\n` +
                    `Link ini aktif selama 24 jam. Jika Anda tidak mendaftar, abaikan email ini.\n`,
            });
            } catch (err) {
                console.error('[auth] sendVerificationEmail failed:', err.message);
                console.log('[auth] DEV FALLBACK — give the user this link manually:');
                console.log('         ', link);
                // Swallow the error. The user can still verify by clicking the
                // link we just printed; auth flows are not blocked.
            }
        },
    },
    session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24, // 1 day
    },
    user: {
        additionalFields: {
            role: {
                // New registrations default to 'client'. Existing users keep
                // whatever role they were inserted with — Better Auth applies
                // defaults at INSERT time only.
                type: 'string',
                defaultValue: 'client',
                input: false,
            },
            accountType: {
                // Phase 4A: separates the "agency vs client" axis from "admin
                // vs user". The custom /register-extended endpoint sets this
                // explicitly (input: false here means clients can't sneak it
                // in via the basic Better Auth signUp).
                type: 'string',
                defaultValue: 'client',
                input: false,
            },
            organizationId: {
                type: 'number',
                input: false,
            },
            isActive: {
                type: 'boolean',
                defaultValue: true,
                input: false,
            },
            isDemo: {
                type: 'boolean',
                defaultValue: false,
                input: false,
            },
        },
    },
    // trustedOrigins must mirror the CORS allowlist in index.js. In
    // production, only the value of CORS_ORIGIN counts; dev keeps the
    // Vite preview ports allowed so npm run dev Just Works. Same env
    // gating shape as index.js to avoid drift.
    trustedOrigins: (() => {
        const prod = process.env.NODE_ENV === 'production';
        const fromEnv = (process.env.CORS_ORIGIN || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        const dev = prod
            ? []
            : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];
        return [...fromEnv, ...dev];
    })(),
});
