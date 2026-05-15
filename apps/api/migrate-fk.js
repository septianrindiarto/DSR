import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);

async function migrate() {
    try {
        // 1. Make orders.car_id nullable
        await sql`ALTER TABLE orders ALTER COLUMN car_id DROP NOT NULL`;
        console.log('✅ orders.car_id is now nullable');

        // 2. Drop old FK on orders.car_id and re-add with ON DELETE SET NULL
        await sql`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_car_id_cars_id_fk`;
        console.log('✅ Dropped old orders FK');
        await sql`ALTER TABLE orders ADD CONSTRAINT orders_car_id_cars_id_fk FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE SET NULL`;
        console.log('✅ Added orders FK with ON DELETE SET NULL');

        // 3. Drop old FK on maintenance.car_id and re-add with ON DELETE CASCADE
        await sql`ALTER TABLE maintenance DROP CONSTRAINT IF EXISTS maintenance_car_id_cars_id_fk`;
        console.log('✅ Dropped old maintenance FK');
        await sql`ALTER TABLE maintenance ADD CONSTRAINT maintenance_car_id_cars_id_fk FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE`;
        console.log('✅ Added maintenance FK with ON DELETE CASCADE');

        console.log('\n🎉 Migration complete!');
    } catch (e) {
        console.error('❌ Migration error:', e.message);
    } finally {
        await sql.end();
    }
}

migrate();
