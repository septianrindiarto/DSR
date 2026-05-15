import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db/index.js';

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
    },
    session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24, // 1 day
    },
    user: {
        additionalFields: {
            role: {
                type: 'string',
                defaultValue: 'admin',
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
    trustedOrigins: [
        process.env.CORS_ORIGIN || 'http://localhost:5173',
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
    ],
});
