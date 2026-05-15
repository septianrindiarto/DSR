import { db } from '../db/index.js';
import { activityLogs, user } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';

export const activityService = {
    async findAll({ page = 1, limit = 50 }) {
        const offset = (page - 1) * limit;
        const results = await db
            .select({ log: activityLogs, user })
            .from(activityLogs)
            .leftJoin(user, eq(activityLogs.userId, user.id))
            .orderBy(desc(activityLogs.createdAt))
            .limit(limit)
            .offset(offset);

        const countResult = await db.select({ count: sql`count(*)` }).from(activityLogs);

        return {
            data: results.map(r => ({
                ...r.log,
                userName: r.user?.name || 'System',
            })),
            total: Number(countResult[0].count),
            page,
            limit,
        };
    },
};
