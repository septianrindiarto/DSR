import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { cars } from './src/db/schema.js';

const sql = postgres(process.env.DATABASE_URL);
const db = drizzle(sql);

async function main() {
  console.log("Fixing consistent car data...");

  // Update id 2 to Honda Brio with its proper image
  await db.update(cars).set({
    name: "Honda Brio",
    type: "City Car",
    capacity: 5,
    transmission: "Automatic",
    price: "300000",
    maxPrice: "300000",
    availableCount: 3,
    available: true,
    image: "https://lh3.googleusercontent.com/aida-public/AB6AXuD9JevXh69XQ5vR0312q3nlgy0prBZnTrc38CI1cSdNQFQcD_on5X2vg-dMpBzcxiwGY2yb3q75-aPZtXAK2NgGOf89m_BPK2pG0ZLKQDcRUjAGC8rMOuAq7lRDfZ9I1aPk5Lwqi2JHiv0eiIvBtCpsIil-x8MdslHhdOTPjNgaLpKAAKw60tYTXxHNE9mXYrElVKbflDv8Rb54DlPZgpKRGjmJPT8RWrjsHUwYIy94Y4IzuQT19tnuVY8dsUFEvh9Z6HjyKfXe2mCx"
  }).where(eq(cars.id, 2));

  // Update id 3 to Mitsubishi Xpander with its proper image
  await db.update(cars).set({
    name: "Mitsubishi Xpander",
    type: "MPV",
    capacity: 7,
    transmission: "Manual",
    price: "500000",
    maxPrice: "500000",
    availableCount: 0,
    available: false,
    image: "https://lh3.googleusercontent.com/aida-public/AB6AXuCHFRKsmpxE0vusYBgqn3-zPXOGzZbwgYM98d3yVr3E9lKIhLYTFIGTer_rMzjuBEj5eQzC7xsw8POw_VM1yeCTNsNF7Xx_543F5zm5rkvNV5Y04e54egpOSRR1Gmxzaav-JalgO8EPPk1terspTSZjl8N04kbRYrQgBUcpMsO6V2sLVq0PfSv9tXOVgtyhZ4G1KSyf-D-Z48goBhAWPHgWwhohcPFX6fVVOUqqJd8DWfdxSr72r6EkJ3PvitfJhjp-URwieWouFzmD"
  }).where(eq(cars.id, 3));

  console.log("Images and titles fixed successfully.");
  process.exit(0);
}

main().catch(console.error);
