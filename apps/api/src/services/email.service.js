// ─── Email transport — Gmail SMTP via nodemailer ──────────────────────────
// All outgoing email goes through this single module so future transport
// swaps (Gmail → Mailgun → SES, etc.) touch one file instead of every feature.
//
// Required env vars (in apps/api/.env):
//   GMAIL_USER          — full Gmail address used as the sender (e.g.
//                         septianrindiarto@gmail.com)
//   GMAIL_APP_PASSWORD  — 16-character App Password created at
//                         https://myaccount.google.com/apppasswords
//                         (NOT your normal Gmail password)
//   GMAIL_FROM_NAME     — display name shown in the recipient's inbox,
//                         e.g. "DSR Solution"
//
// Why an App Password?
//   Google blocks logins from "less secure apps" with the normal account
//   password. An App Password is a one-purpose token Google generates for
//   you; it works only with 2FA enabled and only for SMTP, and can be
//   revoked from your Google account at any time.
//
// The transporter is constructed lazily (and via dynamic import) so the API
// boots cleanly even before `npm install` has fetched the nodemailer package
// or before the .env vars are filled in.

let _transporter = null;

async function getTransporter() {
    if (_transporter) return _transporter;
    const user = process.env.GMAIL_USER;
    if (!user) {
        throw new Error('Email send aborted: GMAIL_USER is not configured in apps/api/.env.');
    }

    const mod = await import('nodemailer').catch(() => null);
    if (!mod) {
        throw new Error(
            'Email send aborted: the `nodemailer` package is not installed. ' +
            'Run `npm install` inside apps/api/.'
        );
    }
    const nodemailer = mod.default || mod;

    // Mode A — OAuth2 (Workspace accounts where App Passwords aren't available).
    // If a refresh token is set we use it; nodemailer will exchange it for a
    // short-lived access token automatically on every send.
    const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
    if (refreshToken && clientId && clientSecret) {
        _transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: {
                type: 'OAuth2',
                user,
                clientId,
                clientSecret,
                refreshToken,
            },
        });
        return _transporter;
    }

    // Mode B — App Password (personal Gmail accounts).
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!pass) {
        throw new Error(
            'Email send aborted: no usable Gmail credentials. Set EITHER ' +
            '(GMAIL_OAUTH_REFRESH_TOKEN + GMAIL_OAUTH_CLIENT_ID + GMAIL_OAUTH_CLIENT_SECRET) ' +
            'for Workspace accounts, OR GMAIL_APP_PASSWORD for personal @gmail.com accounts.'
        );
    }
    _transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user, pass },
    });
    return _transporter;
}

function getFromAddress() {
    const user = process.env.GMAIL_USER;
    const name = process.env.GMAIL_FROM_NAME || 'DSR Solution';
    if (!user) {
        throw new Error('Email send aborted: GMAIL_USER is not configured.');
    }
    return `"${name}" <${user}>`;
}

/**
 * Send a transactional email.
 *
 * @param {object}  args
 * @param {string}  args.to       — Recipient address.
 * @param {string}  args.subject  — Email subject line.
 * @param {string}  [args.html]   — HTML body. At least one of html/text is required.
 * @param {string}  [args.text]   — Plain-text body.
 * @returns {Promise<{messageId: string}>} nodemailer info object.
 */
export async function sendEmail({ to, subject, html, text }) {
    if (!to) throw new Error('sendEmail: `to` is required.');
    if (!subject) throw new Error('sendEmail: `subject` is required.');
    if (!html && !text) throw new Error('sendEmail: provide `html` or `text` body.');

    const transporter = await getTransporter();
    const from = getFromAddress();

    const info = await transporter.sendMail({ from, to, subject, html, text });
    return info;
}

// ─── Invite-code email ────────────────────────────────────────────────────
// Phase 4A: emailed to a freshly registered client admin so they can share
// the code with their team. Failure logged, never thrown.
export async function sendInviteCodeEmail({ to, adminName, companyName, inviteCode }) {
    const safeName = adminName || '';
    const subject = `Kode undangan ${companyName} - DSR Solution`;
    const html = `<!doctype html>
<html><body style="font-family:Inter,Arial,sans-serif;background:#fcf8f8;padding:32px;">
  <table style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #eacdce;padding:32px;">
    <tr><td>
      <h1 style="color:#1d0c0d;font-size:22px;margin:0 0 8px;">Halo ${safeName},</h1>
      <p style="color:#4a4a4a;font-size:14px;line-height:1.6;margin:0 0 16px;">
        Selamat! Anda terdaftar sebagai <b>Admin</b> untuk <b>${companyName}</b> di DSR Solution.
      </p>
      <p style="color:#4a4a4a;font-size:14px;line-height:1.6;margin:0 0 20px;">
        Berikut kode undangan perusahaan. Bagikan ke rekan tim agar mereka
        bisa bergabung ke perusahaan yang sama saat mendaftar:
      </p>
      <p style="text-align:center;margin:24px 0;">
        <span style="display:inline-block;background:#ff0008;color:#ffffff;
          padding:18px 32px;border-radius:10px;font-size:28px;font-weight:700;
          letter-spacing:4px;font-family:Courier New,monospace;">${inviteCode}</span>
      </p>
      <p style="color:#888;font-size:12px;line-height:1.6;margin:0;text-align:center;">
        Rekan tim membuka halaman registrasi, pilih Sebagai Client, masukkan
        kode di atas pada kolom Kode Undangan.
      </p>
    </td></tr>
  </table>
</body></html>`;
    const text = `Halo ${safeName},\n\nAnda terdaftar sebagai Admin untuk ${companyName}.\n\nKode undangan: ${inviteCode}\n\nBagikan kode ini ke rekan tim.\n`;
    try {
        await sendEmail({ to, subject, html, text });
    } catch (err) {
        console.error('[email] sendInviteCodeEmail failed:', err.message);
        console.log('[email] Invite code for', companyName, 'admin', to, ':', inviteCode);
    }
}
