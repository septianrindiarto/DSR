import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { cars } from './src/db/schema.js';

const sql = postgres(process.env.DATABASE_URL);
const db = drizzle(sql);

async function main() {
  console.log("Updating cars...");

  // Update Avanza (id: 1)
  await db.update(cars).set({
    price: "350000",
    maxPrice: "450000",
    availableCount: 5,
    available: true,
    image: "https://lh3.googleusercontent.com/aida-public/AB6AXuCGdGzO0k2fgH1PR_-QiqGuC0-gXtHBDT3Gd9feHgB6G6gTmYAJzfbDu-04mNN_j__E3DKQzpXBaG9ICw905pgZpRz1SVbwt-ixtN6M7XyrPOgz74LZ0eibrkPSGivE6vKPfDbkUkO0mmc9ixgMrkgh2Hx1VHjYUw91iHehDSuOt6_M0VYCb520SwAa92FGlKh6vKDFQlMGZLMEl3U2rloG1VWl1zHROeGtU-9KWjFZ6Em9Du99qhgwneYWeo7AOEp6d-zXp8WQyvKK"
  }).where(eq(cars.id, 1));

  // Update CR-V
  await db.update(cars).set({
    price: "700000",
    maxPrice: "750000",
    availableCount: 0,
    available: false
  }).where(eq(cars.id, 2));

  // Update Xpander
  await db.update(cars).set({
    price: "500000",
    maxPrice: "500000",
    availableCount: 3,
    available: true
  }).where(eq(cars.id, 3));

  console.log("Cars updated successfully.");
  process.exit(0);
}

main().catch(console.error);
