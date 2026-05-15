import { db } from '../db/index.js';
import { reviews, customers, orders } from '../db/schema.js';
import { eq, desc, sql, and } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';

export const reviewService = {
    async findAll({ page = 1, limit = 20, scopeUser = null }) {
        const offset = (page - 1) * limit;

        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: reviews.organizationId,
            isDemo: reviews.isDemo,
            createdBy: reviews.createdBy,
        });

        let query = db
            .select({ review: reviews, customer: customers })
            .from(reviews)
            .leftJoin(customers, eq(reviews.customerId, customers.id));

        if (scopeConds.length) query = query.where(and(...scopeConds));

        const results = await query.orderBy(desc(reviews.createdAt)).limit(limit).offset(offset);

        let countQ = db.select({ count: sql`count(*)` }).from(reviews);
        if (scopeConds.length) countQ = countQ.where(and(...scopeConds));
        const countResult = await countQ;

        return {
            data: results.map(r => ({ ...r.review, customer: r.customer })),
            total: Number(countResult[0].count),
            page,
            limit,
        };
    },

    async create(data) {
        const result = await db.insert(reviews).values(data).returning();
        return result[0];
    },
};
