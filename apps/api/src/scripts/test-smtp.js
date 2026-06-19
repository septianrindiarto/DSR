#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// SMTP smoke test — supports both auth modes used by email.service.js:
//   • OAuth2  (preferred — for Google Workspace accounts)
//   • App Password (fallback — for personal @gmail.com)
//
// Usage:
//   cd apps/api
//   node src/scripts/test-smtp.js                   # sends a test to GMAIL_USER
//   node src/scripts/test-smtp.js you@gmail.com     # sends to a specific address
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import nodemailer from 'nodemailer';

const user = process.env.GMAIL_USER;
const fromName = process.env.GMAIL_FROM_NAME || 'DSR Solution Test';
const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
const pass = process.env.GMAIL_APP_PASSWORD;

if (!user) {
    console.error('ERROR: GMAIL_USER must be set in apps/api/.env');
    process.exit(1);
}

let authConfig;
let mode;
if (refreshToken && clientId && clientSecret) {
    mode = 'OAuth2';
    authConfig = {
        type: 'OAuth2',
        user,
        clientId,
        clientSecret,
        refreshToken,
    };
    console.log('\nUsing OAuth2 (Workspace mode).');
    console.log('  Client ID:    ', clientId.slice(0, 20) + '...');
    console.log('  Refresh token:', refreshToken.slice(0, 20) + '... (length:', refreshToken.length + ')');
} else if (pass) {
    mode = 'App Password';
    authConfig = { user, pass };
    console.log('\nUsing App Password (personal Gmail mode).');
    console.log('  Password length:', pass.length, '(should be 16)');
} else {
    console.error(
        'ERROR: No usable Gmail credentials in apps/api/.env\n' +
        '  Set EITHER (GMAIL_OAUTH_REFRESH_TOKEN + GMAIL_OAUTH_CLIENT_ID + GMAIL_OAUTH_CLIENT_SECRET)\n' +
        '  OR GMAIL_APP_PASSWORD.'
    );
    process.exit(1);
}

const to = process.argv[2] || user;
console.log(`\nSender: ${user} → Recipient: ${to}\n`);
console.log('Connecting to smtp.gmail.com:587 with STARTTLS ...\n');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: authConfig,
    logger: true,
    debug: true,
});

try {
    console.log('Verifying connection + credentials ...');
    await transporter.verify();
    console.log(`\n✓ Gmail accepted the credentials. ${mode} works.\n`);

    console.log('Sending a 1-line test message ...');
    const info = await transporter.sendMail({
        from: `"${fromName}" <${user}>`,
        to,
        subject: 'DSR SMTP test — please ignore',
        text: `If you can read this, your DSR API email transport is working (${mode} mode).`,
    });
    console.log('\n✓ Sent. Server messageId:', info.messageId);
    console.log('  Check the inbox AND the spam folder for', to);
} catch (err) {
    console.error('\n✗ SMTP test failed.');
    console.error('  Error:', err.message);
    if (err.code) console.error('  Code:', err.code);
    if (err.response) console.error('  Server said:', err.response);
    console.error('\nCommon causes:');
    if (mode === 'OAuth2') {
        console.error('  • "invalid_grant" → refresh token was generated with the wrong scope. Re-do the OAuth Playground step with scope https://mail.google.com/');
        console.error('  • "Token has been expired or revoked" → re-do the Playground step and paste a fresh refresh token');
        console.error('  • "access_denied" → admin@dsrappai.com was not added as a Test user on the OAuth consent screen');
        console.error('  • "invalid_client" → CLIENT_ID or CLIENT_SECRET is wrong / truncated');
    } else {
        console.error('  • "Username and Password not accepted" → App Password was generated for a different Google account, or 2FA isn\'t enabled');
        console.error('  • "Connection timeout" → firewall is blocking port 587');
    }
    process.exit(1);
}

await transporter.close();
