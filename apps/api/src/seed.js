// ────────────────────────────────────────────────────────────────────────────
//  DEMO DATA SEEDER  —  NON-DESTRUCTIVE
// ────────────────────────────────────────────────────────────────────────────
//  This script ONLY touches rows tagged `is_demo = true`.  Your real
//  production data (is_demo = false / NULL) is never read or modified.
//
//  Behaviour:
//    1. Apply migration first:  npm run migrate -- demo_isolation
//    2. Run this seed:          npm run db:seed
//
//    On every run it:
//      • DELETEs only is_demo = true rows from cars, orders, customers,
//        drivers, maintenance, reviews, journal_entries, chart_of_accounts.
//      • Re-inserts a fresh, identifiable set of demo rows (license plates
//        prefixed "DEMO-", customer emails "demo+xxx@dsrsolution.com", etc).
//      • Idempotently creates the demo admin user used by the "Try Demo"
//        button on /admin/login.
//
//  Want to nuke EVERYTHING (real + demo) and start over?  See seed-reset.js
//  (run with `npm run db:seed:reset`) — destructive, opt-in only.
// ────────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';
import { db } from './db/index.js';
import {
    cars,
    customers,
    drivers,
    orders,
    maintenance,
    reviews,
    chartOfAccounts,
    journalEntries,
    user as userTable,
    account as accountTable,
} from './db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { auth } from './auth.js';

dotenv.config();

// ─── Demo admin credentials (also referenced by the "Try Demo" button) ─────
const DEMO_EMAIL = 'demo@dsrsolution.com';
const DEMO_PASSWORD = 'demo123';
const DEMO_NAME = 'Demo Admin';

// ─── Seed data (everything inserted gets isDemo: true) ─────────────────────
const seedCars = [
    { name: 'New Avanza', brand: 'Toyota', type: 'MPV', category: 'economy', year: 2023, licensePlate: 'DEMO-001 DSR', color: 'Putih', image: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0afa?w=600&h=400&fit=crop', gallery: ['https://images.unsplash.com/photo-1549317661-bd32c8ce0afa?w=600&h=400&fit=crop','https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&h=400&fit=crop'], price: '350000', capacity: 7, transmission: 'Manual', fuel: 'Bensin', description: 'MPV favorit keluarga Indonesia, fitur keselamatan terbaru, interior luas, dan efisiensi BBM optimal.', features: ['AC Double','Audio System','USB Port','Power Steering'], status: 'available', availableCount: 3 },
    { name: 'All New Brio', brand: 'Honda', type: 'City Car', category: 'economy', year: 2022, licensePlate: 'DEMO-002 DSR', color: 'Merah', image: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=600&h=400&fit=crop', gallery: [], price: '300000', capacity: 5, transmission: 'Automatic', fuel: 'Bensin', description: 'Mobilitas harian perkotaan, desain sporty, mesin irit, dan fitur keselamatan canggih.', features: ['AC','Power Window','Audio System'], status: 'available', availableCount: 2 },
    { name: 'Innova Reborn', brand: 'Toyota', type: 'MPV', category: 'standard', year: 2023, licensePlate: 'DEMO-003 DSR', color: 'Hitam', image: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=600&h=400&fit=crop', gallery: [], price: '500000', capacity: 7, transmission: 'Manual', fuel: 'Diesel', description: 'Kenyamanan kelas premium dengan ruang kabin luas dan performa diesel tangguh.', features: ['AC Double','Leather Seats','Cruise Control','Rear Camera'], status: 'available', availableCount: 2 },
    { name: 'Xpander Cross', brand: 'Mitsubishi', type: 'MPV', category: 'standard', year: 2023, licensePlate: 'DEMO-004 DSR', color: 'Silver', image: 'https://images.unsplash.com/photo-1619767886558-efdc259cde1a?w=600&h=400&fit=crop', gallery: [], price: '450000', capacity: 7, transmission: 'Automatic', fuel: 'Bensin', description: 'Memadukan kenyamanan MPV dengan ketangguhan SUV, desain bold dan sporty.', features: ['AC Double','Touchscreen','USB Port','Roof Rail'], status: 'available', availableCount: 2 },
    { name: 'Pajero Sport', brand: 'Mitsubishi', type: 'SUV', category: 'premium', year: 2023, licensePlate: 'DEMO-005 DSR', color: 'Putih', image: 'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=600&h=400&fit=crop', gallery: [], price: '850000', capacity: 7, transmission: 'Automatic', fuel: 'Diesel', description: 'SUV tangguh dengan kemampuan off-road luar biasa, teknologi Super Select 4WD.', features: ['AC Double','Cruise Control','Leather Seats','4WD','Sunroof'], status: 'available', availableCount: 1 },
    { name: 'Fortuner VRZ', brand: 'Toyota', type: 'SUV', category: 'premium', year: 2023, licensePlate: 'DEMO-006 DSR', color: 'Silver', image: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=600&h=400&fit=crop', gallery: [], price: '950000', capacity: 7, transmission: 'Automatic', fuel: 'Diesel', description: 'SUV premium dengan performa diesel handal dan interior mewah.', features: ['AC Double','Leather Seats','Cruise Control','Rear Camera','Hill Assist'], status: 'available', availableCount: 1 },
    { name: 'Civic Turbo', brand: 'Honda', type: 'Sedan', category: 'premium', year: 2023, licensePlate: 'DEMO-007 DSR', color: 'Hitam', image: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=600&h=400&fit=crop', gallery: [], price: '900000', capacity: 5, transmission: 'Automatic', fuel: 'Pertamax', description: 'Performa mesin turbo bertenaga, desain sedan sporty dan elegan.', features: ['AC','Turbo Engine','Sunroof','Leather Seats','Honda Sensing'], status: 'available', availableCount: 1 },
    { name: 'Ertiga GX', brand: 'Suzuki', type: 'MPV', category: 'economy', year: 2022, licensePlate: 'DEMO-008 DSR', color: 'Abu-abu', image: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=600&h=400&fit=crop', gallery: [], price: '325000', capacity: 7, transmission: 'Manual', fuel: 'Bensin', description: 'Ruang kabin lega dengan harga terjangkau, pilihan cerdas keluarga.', features: ['AC','Power Window','Audio System','USB Port'], status: 'available', availableCount: 2 },
    { name: 'Innova Zenix Hybrid', brand: 'Toyota', type: 'MPV', category: 'premium', year: 2024, licensePlate: 'DEMO-009 DSR', color: 'Putih Mutiara', image: 'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=600&h=400&fit=crop', gallery: [], price: '750000', capacity: 7, transmission: 'Automatic', fuel: 'Bensin', description: 'Efisiensi mesin hybrid dengan kemewahan kabin, ideal eksekutif modern.', features: ['Hybrid','AC Double','Captain Seat','Panoramic Roof','TSS'], status: 'available', availableCount: 2 },
    { name: 'Toyota Veloz', brand: 'Toyota', type: 'MPV', category: 'standard', year: 2024, licensePlate: 'DEMO-010 DSR', color: 'Putih', image: 'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=600&h=400&fit=crop', gallery: [], price: '420000', capacity: 7, transmission: 'Automatic', fuel: 'Bensin', description: 'Desain stylish, kabin lega, fitur keselamatan TSS.', features: ['TSS','AC Double','Touchscreen','Cruise Control'], status: 'available', availableCount: 3 },
    { name: 'Suzuki XL7', brand: 'Suzuki', type: 'SUV', category: 'standard', year: 2023, licensePlate: 'DEMO-011 DSR', color: 'Cool Black', image: 'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=600&h=400&fit=crop', gallery: [], price: '400000', capacity: 7, transmission: 'Automatic', fuel: 'Bensin', description: 'Crossover keluarga dengan ground clearance tinggi dan kabin lapang.', features: ['AC Double','ESP','Hill Hold','Cruise Control'], status: 'available', availableCount: 2 },
    { name: 'Hilux Double Cabin', brand: 'Toyota', type: 'SUV', category: 'premium', year: 2023, licensePlate: 'DEMO-012 DSR', color: 'Putih', image: 'https://images.unsplash.com/photo-1605893477799-b99e3b8b93fe?w=600&h=400&fit=crop', gallery: [], price: '1100000', capacity: 5, transmission: 'Manual', fuel: 'Diesel', description: 'Tangguh untuk operasional lapangan, dilengkapi 4WD dan bak kargo luas.', features: ['4WD','AC','Power Steering','Bull Bar'], status: 'available', availableCount: 1 },
    { name: 'Honda HR-V Turbo', brand: 'Honda', type: 'SUV', category: 'premium', year: 2024, licensePlate: 'DEMO-013 DSR', color: 'Meteoroid Gray', image: 'https://images.unsplash.com/photo-1613467143018-9b89e9d8ff03?w=600&h=400&fit=crop', gallery: [], price: '780000', capacity: 5, transmission: 'Automatic', fuel: 'Pertamax', description: 'Mesin VTEC Turbo, desain coupe-SUV elegan, dan Honda Sensing terbaru.', features: ['Honda Sensing','Sunroof','Leather Seats','Turbo'], status: 'available', availableCount: 1 },
    { name: 'Daihatsu Sigra', brand: 'Daihatsu', type: 'MPV', category: 'economy', year: 2023, licensePlate: 'DEMO-014 DSR', color: 'Merah', image: 'https://images.unsplash.com/photo-1494905998402-395d579af36f?w=600&h=400&fit=crop', gallery: [], price: '275000', capacity: 7, transmission: 'Manual', fuel: 'Bensin', description: 'LCGC 7-seater paling terjangkau, hemat BBM, praktis untuk keluarga muda.', features: ['AC','Power Window','Audio'], status: 'available', availableCount: 4 },
    { name: 'Mitsubishi Triton', brand: 'Mitsubishi', type: 'SUV', category: 'premium', year: 2023, licensePlate: 'DEMO-015 DSR', color: 'Putih', image: 'https://images.unsplash.com/photo-1612825173281-9a193378527e?w=600&h=400&fit=crop', gallery: [], price: '1050000', capacity: 5, transmission: 'Manual', fuel: 'Diesel', description: 'Operasional perusahaan, mining, dan konstruksi. Mesin diesel powerful dan 4WD.', features: ['4WD','AC','Hill Descent Control'], status: 'available', availableCount: 1 },
    { name: 'Toyota Calya', brand: 'Toyota', type: 'MPV', category: 'economy', year: 2022, licensePlate: 'DEMO-016 DSR', color: 'Silver', image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&h=400&fit=crop', gallery: [], price: '290000', capacity: 7, transmission: 'Manual', fuel: 'Bensin', description: 'MPV LCGC 7-seater dengan harga sewa paling terjangkau.', features: ['AC','Audio','Power Steering'], status: 'available', availableCount: 3 },
    { name: 'Wuling Almaz RS', brand: 'Wuling', type: 'SUV', category: 'standard', year: 2023, licensePlate: 'DEMO-017 DSR', color: 'Pristine White', image: 'https://images.unsplash.com/photo-1550355291-bbee04a92027?w=600&h=400&fit=crop', gallery: [], price: '600000', capacity: 7, transmission: 'Automatic', fuel: 'Bensin', description: 'Wuling Indonesian Command dan fitur ADAS, SUV pintar dengan harga kompetitif.', features: ['ADAS','Voice Command','Panoramic Sunroof','360 Camera'], status: 'available', availableCount: 2 },
    { name: 'BMW 320i Sport', brand: 'BMW', type: 'Sedan', category: 'luxury', year: 2023, licensePlate: 'DEMO-018 DSR', color: 'Mineral Grey', image: 'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=600&h=400&fit=crop', gallery: [], price: '1800000', capacity: 5, transmission: 'Automatic', fuel: 'Pertamax', description: 'Pengalaman berkendara premium, untuk eksekutif dan acara VIP.', features: ['Premium Audio','Leather Seats','Driving Assist','Sport Mode'], status: 'available', availableCount: 1 },
    { name: 'Mercedes-Benz E-Class', brand: 'Mercedes-Benz', type: 'Sedan', category: 'luxury', year: 2023, licensePlate: 'DEMO-019 DSR', color: 'Obsidian Black', image: 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=600&h=400&fit=crop', gallery: [], price: '2200000', capacity: 5, transmission: 'Automatic', fuel: 'Pertamax', description: 'Sedan premium pilihan eksekutif. Interior mewah, performa berkelas.', features: ['Burmester Audio','Massage Seat','MBUX','Distronic Plus'], status: 'available', availableCount: 1 },
    { name: 'Hyundai Stargazer', brand: 'Hyundai', type: 'MPV', category: 'standard', year: 2024, licensePlate: 'DEMO-020 DSR', color: 'Creamy White', image: 'https://images.unsplash.com/photo-1606220838315-056192d5e927?w=600&h=400&fit=crop', gallery: [], price: '480000', capacity: 7, transmission: 'Automatic', fuel: 'Bensin', description: 'Desain futuristik dan kabin paling lega di kelasnya.', features: ['SmartSense','Wireless Charging','Captain Seat','Cruise Control'], status: 'maintenance', availableCount: 1 },
];

const seedCustomers = [
    { name: 'Budi Santoso', email: 'demo+budi@dsrsolution.com',   phone: '+62 812-3456-7890', whatsapp: '6281234567890', customerType: 'private', job: 'Wiraswasta', status: 'vip', totalOrders: 24 },
    { name: 'Siti Aminah', email: 'demo+siti@dsrsolution.com',    phone: '+62 819-8765-4321', whatsapp: '6281987654321', customerType: 'private', job: 'Pegawai Negeri', status: 'active', totalOrders: 8 },
    { name: 'PT Maju Bersama', companyName: 'PT Maju Bersama', email: 'demo+majubersama@dsrsolution.com', phone: '+62 811-2233-4455', whatsapp: '6281122334455', customerType: 'company', job: 'Perusahaan Logistik', status: 'vip', totalOrders: 41 },
    { name: 'Rina Marlina', email: 'demo+rina@dsrsolution.com',   phone: '+62 855-6677-8899', whatsapp: '6285566778899', customerType: 'private', job: 'Dokter', status: 'active', totalOrders: 5 },
    { name: 'Andi Wijaya', companyName: 'PT Sinar Andi', email: 'demo+andi@dsrsolution.com', phone: '+62 899-8877-6655', whatsapp: '6289988776655', customerType: 'company', job: 'Manager IT', status: 'active', totalOrders: 12 },
    { name: 'Dewi Lestari', email: 'demo+dewi@dsrsolution.com',   phone: '+62 813-9090-1010', whatsapp: '6281390901010', customerType: 'private', job: 'Marketing Executive', status: 'active', totalOrders: 6 },
    { name: 'Hendro Susanto', email: 'demo+hendro@dsrsolution.com', phone: '+62 856-2345-6789', whatsapp: '6285623456789', customerType: 'private', job: 'Engineer', status: 'active', totalOrders: 3 },
    { name: 'PT Karya Mandiri', companyName: 'PT Karya Mandiri', email: 'demo+karyamandiri@dsrsolution.com', phone: '+62 21-8765-4321', whatsapp: '622187654321', customerType: 'company', job: 'Konstruksi', status: 'vip', totalOrders: 33 },
    { name: 'Maya Sari', email: 'demo+maya@dsrsolution.com',      phone: '+62 822-1122-3344', whatsapp: '6282211223344', customerType: 'private', job: 'Influencer', status: 'active', totalOrders: 9 },
    { name: 'Bambang Prakoso', email: 'demo+bambang@dsrsolution.com', phone: '+62 815-5544-3322', whatsapp: '6281555443322', customerType: 'private', job: 'Wiraswasta', status: 'vip', totalOrders: 17 },
    { name: 'PT Cipta Rasa', companyName: 'PT Cipta Rasa Nusantara', email: 'demo+ciptarasa@dsrsolution.com', phone: '+62 21-5566-7788', whatsapp: '622155667788', customerType: 'company', job: 'Food & Beverage', status: 'active', totalOrders: 18 },
    { name: 'Linda Kartika', email: 'demo+linda@dsrsolution.com', phone: '+62 858-9988-7766', whatsapp: '6285899887766', customerType: 'private', job: 'Notaris', status: 'active', totalOrders: 7 },
    { name: 'Eko Saputra', email: 'demo+eko@dsrsolution.com',     phone: '+62 877-1212-3434', whatsapp: '6287712123434', customerType: 'private', job: 'Pilot', status: 'active', totalOrders: 4 },
    { name: 'CV Berkah Jaya', companyName: 'CV Berkah Jaya', email: 'demo+berkahjaya@dsrsolution.com', phone: '+62 22-3344-5566', whatsapp: '622233445566', customerType: 'company', job: 'Travel & Tour', status: 'vip', totalOrders: 28 },
    { name: 'Putri Anggraeni', email: 'demo+putri@dsrsolution.com', phone: '+62 821-7766-5544', whatsapp: '6282177665544', customerType: 'private', job: 'Lawyer', status: 'active', totalOrders: 6 },
];

const seedDrivers = [
    { name: 'Ahmad Supardi', phone: '+62 999-9000-0001', licenseNumber: 'DEMO-SIM-0001', licenseExpiry: new Date('2027-06-15'), status: 'active', address: 'Jl. Kebon Jeruk No. 45, Jakarta Barat' },
    { name: 'Dedi Kurniawan', phone: '+62 999-9000-0002', licenseNumber: 'DEMO-SIM-0002', licenseExpiry: new Date('2028-03-20'), status: 'active', address: 'Jl. Raya Bogor KM 25, Depok' },
    { name: 'Rudi Hartono', phone: '+62 999-9000-0003', licenseNumber: 'DEMO-SIM-0003', licenseExpiry: new Date('2027-12-01'), status: 'active', address: 'Jl. Sudirman No. 78, Tangerang' },
    { name: 'Joko Prasetyo', phone: '+62 999-9000-0004', licenseNumber: 'DEMO-SIM-0004', licenseExpiry: new Date('2026-09-10'), status: 'inactive', address: 'Jl. Gatot Subroto No. 12, Bekasi', notes: 'Sedang cuti' },
    { name: 'Bagus Setiawan', phone: '+62 999-9000-0005', licenseNumber: 'DEMO-SIM-0005', licenseExpiry: new Date('2028-01-30'), status: 'active', address: 'Jl. Margonda Raya No. 21, Depok' },
    { name: 'Wahyu Adi', phone: '+62 999-9000-0006', licenseNumber: 'DEMO-SIM-0006', licenseExpiry: new Date('2027-04-22'), status: 'active', address: 'Jl. Cilandak Tengah No. 5, Jakarta Selatan' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[rand(0, arr.length - 1)]; }
function daysAgo(n) { return new Date(Date.now() - n * 86400000); }
function daysAhead(n) { return new Date(Date.now() + n * 86400000); }

function buildOrders(insertedCars, insertedCustomers, insertedDrivers) {
    const out = [];
    const destinations = ['Bandung', 'Bogor', 'Puncak', 'Yogyakarta', 'Bali', 'Lampung', 'Surabaya', 'Anyer', 'Garut', 'Pangandaran'];
    const packages = ['Lepas Kunci', 'Dengan Driver', 'All-In Paket'];
    let n = 1;
    const mkNo = () => `DEMO-ORD-${String(n++).padStart(4, '0')}`;
    for (let i = 0; i < 30; i++) {
        const car = pick(insertedCars);
        const startOffset = rand(15, 180);
        const days = rand(1, 7);
        const daily = parseInt(car.price);
        out.push({ orderNumber: mkNo(), carId: car.id, customerId: pick(insertedCustomers).id, driverId: Math.random() < 0.6 ? pick(insertedDrivers).id : null, pickupDate: daysAgo(startOffset), returnDate: daysAgo(startOffset - days), totalDays: days, dailyRate: String(daily), totalPrice: String(daily * days), status: 'completed', destination: pick(destinations), package: pick(packages), approvedAt: daysAgo(startOffset + 1) });
    }
    for (let i = 0; i < 8; i++) {
        const car = pick(insertedCars);
        const days = rand(2, 5);
        const offset = rand(0, days - 1);
        const daily = parseInt(car.price);
        out.push({ orderNumber: mkNo(), carId: car.id, customerId: pick(insertedCustomers).id, driverId: Math.random() < 0.7 ? pick(insertedDrivers).id : null, pickupDate: daysAgo(offset), returnDate: daysAhead(days - offset), totalDays: days, dailyRate: String(daily), totalPrice: String(daily * days), status: 'active', destination: pick(destinations), package: pick(packages), approvedAt: daysAgo(offset + 1) });
    }
    for (let i = 0; i < 7; i++) {
        const car = pick(insertedCars);
        const startAhead = rand(2, 21);
        const days = rand(1, 6);
        const daily = parseInt(car.price);
        out.push({ orderNumber: mkNo(), carId: car.id, customerId: pick(insertedCustomers).id, driverId: Math.random() < 0.5 ? pick(insertedDrivers).id : null, pickupDate: daysAhead(startAhead), returnDate: daysAhead(startAhead + days), totalDays: days, dailyRate: String(daily), totalPrice: String(daily * days), status: 'confirmed', destination: pick(destinations), package: pick(packages), approvedAt: daysAgo(rand(0, 3)) });
    }
    for (let i = 0; i < 5; i++) {
        const car = pick(insertedCars);
        const startAhead = rand(3, 30);
        const days = rand(1, 5);
        const daily = parseInt(car.price);
        out.push({ orderNumber: mkNo(), carId: car.id, customerId: pick(insertedCustomers).id, pickupDate: daysAhead(startAhead), returnDate: daysAhead(startAhead + days), totalDays: days, dailyRate: String(daily), totalPrice: String(daily * days), status: 'pending', destination: pick(destinations), package: pick(packages) });
    }
    return out;
}

const seedCoA = [
    { code: 'DEMO-1010', name: 'Kas Tunai (DEMO)', type: 'asset', normalBalance: 'debit', description: 'Kas operasional kantor' },
    { code: 'DEMO-1020', name: 'Bank BCA (DEMO)', type: 'asset', normalBalance: 'debit', description: 'Rekening operasional' },
    { code: 'DEMO-1110', name: 'Piutang Usaha (DEMO)', type: 'asset', normalBalance: 'debit' },
    { code: 'DEMO-1210', name: 'Armada Kendaraan (DEMO)', type: 'asset', normalBalance: 'debit', description: 'Aset tetap kendaraan' },
    { code: 'DEMO-2010', name: 'Hutang Usaha (DEMO)', type: 'liability', normalBalance: 'credit' },
    { code: 'DEMO-3010', name: 'Modal Pemilik (DEMO)', type: 'equity', normalBalance: 'credit' },
    { code: 'DEMO-4010', name: 'Pendapatan Sewa (DEMO)', type: 'income', normalBalance: 'credit', description: 'Sewa harian/paket' },
    { code: 'DEMO-4020', name: 'Pendapatan Driver (DEMO)', type: 'income', normalBalance: 'credit' },
    { code: 'DEMO-5010', name: 'Beban BBM (DEMO)', type: 'expense', normalBalance: 'debit' },
    { code: 'DEMO-5020', name: 'Beban Maintenance (DEMO)', type: 'expense', normalBalance: 'debit' },
    { code: 'DEMO-5030', name: 'Beban Gaji Driver (DEMO)', type: 'expense', normalBalance: 'debit' },
    { code: 'DEMO-5040', name: 'Beban Operasional Kantor (DEMO)', type: 'expense', normalBalance: 'debit' },
];

function buildJournalEntries() {
    const entries = [];
    let ref = 1;
    const year = new Date().getFullYear();
    const mkRef = () => `DEMO-JU-${year}-${String(ref++).padStart(4, '0')}`;
    for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
        const d = new Date();
        d.setMonth(d.getMonth() - monthsAgo);
        const entryDate = new Date(d.getFullYear(), d.getMonth(), 15);
        const month = d.getMonth() + 1;
        const revenue = rand(85_000_000, 145_000_000);
        const fuel = rand(8_000_000, 14_000_000);
        const maint = rand(5_000_000, 12_000_000);
        const salary = 18_000_000;
        const office = rand(3_000_000, 6_000_000);
        const r1 = mkRef();
        entries.push({ entryDate, month, description: `Setoran sewa bulan ${d.toLocaleString('id-ID', { month: 'long' })}`, category: 'Pendapatan Sewa', debit: String(revenue), credit: '0', reference: 'BCA', journalRef: r1 });
        entries.push({ entryDate, month, description: `Pendapatan sewa bulan ${d.toLocaleString('id-ID', { month: 'long' })}`, category: 'Pendapatan Sewa', debit: '0', credit: String(revenue), reference: 'INV', journalRef: r1 });
        const r2 = mkRef();
        entries.push({ entryDate, month, description: 'Beban BBM operasional', category: 'Beban BBM', debit: String(fuel), credit: '0', reference: 'PT-BBM', journalRef: r2 });
        entries.push({ entryDate, month, description: 'Pembayaran BBM', category: 'Beban BBM', debit: '0', credit: String(fuel), reference: 'BCA', journalRef: r2 });
        const r3 = mkRef();
        entries.push({ entryDate, month, description: 'Servis dan perbaikan armada', category: 'Beban Maintenance', debit: String(maint), credit: '0', reference: 'BENGKEL', journalRef: r3 });
        entries.push({ entryDate, month, description: 'Bayar bengkel', category: 'Beban Maintenance', debit: '0', credit: String(maint), reference: 'BCA', journalRef: r3 });
        const r4 = mkRef();
        entries.push({ entryDate, month, description: 'Gaji driver bulanan', category: 'Beban Gaji', debit: String(salary), credit: '0', reference: 'PAYROLL', journalRef: r4 });
        entries.push({ entryDate, month, description: 'Pembayaran gaji', category: 'Beban Gaji', debit: '0', credit: String(salary), reference: 'BCA', journalRef: r4 });
        const r5 = mkRef();
        entries.push({ entryDate, month, description: 'Operasional kantor', category: 'Beban Operasional', debit: String(office), credit: '0', reference: 'OFFICE', journalRef: r5 });
        entries.push({ entryDate, month, description: 'Bayar operasional', category: 'Beban Operasional', debit: '0', credit: String(office), reference: 'BCA', journalRef: r5 });
    }
    return entries;
}

// ─── Demo user creation (idempotent, error-aware) ──────────────────────────
async function ensureDemoUser() {
    console.log('👤 Ensuring demo admin user exists...');

    // Check first — if the demo user is already in the DB, do nothing.
    const existing = await db
        .select({ id: userTable.id })
        .from(userTable)
        .where(eq(userTable.email, DEMO_EMAIL))
        .limit(1);

    if (existing.length > 0) {
        console.log(`   ℹ️  ${DEMO_EMAIL} already exists — skipping signup`);
        return;
    }

    // Use better-auth's signup endpoint so the password is hashed identically
    // to how /api/auth/sign-in/email expects it later.  This is the SAME
    // call path the demo button hits at runtime.
    try {
        await auth.api.signUpEmail({
            body: { name: DEMO_NAME, email: DEMO_EMAIL, password: DEMO_PASSWORD },
        });
        console.log(`   ✅ Demo user created: ${DEMO_EMAIL}`);
    } catch (err) {
        // Surface the real reason instead of silently swallowing.
        const msg = err?.message || err?.body?.message || JSON.stringify(err);
        console.error(`   ❌ better-auth signUp failed: ${msg}`);
        console.error('       Demo button will NOT work until this is resolved.');
        console.error('       Try registering ' + DEMO_EMAIL + ' manually at /admin/login,');
        console.error('       or check that BETTER_AUTH_SECRET / BETTER_AUTH_URL env vars are set.');
        throw err;
    }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function seed() {
    try {
        console.log('🌱 Demo data seeder (non-destructive)\n');
        console.log('   Real production data is NEVER touched. Only is_demo=true rows');
        console.log('   are deleted and re-inserted.\n');

        // Wipe ONLY demo rows.  Real rows (is_demo=false / NULL) untouched.
        // FK-aware order: reviews → maintenance → orders → drivers/customers/cars,
        // then journal_entries, chart_of_accounts.
        console.log('🧹 Removing previous demo rows...');
        await db.execute(sql`DELETE FROM reviews          WHERE is_demo = true`);
        await db.execute(sql`DELETE FROM maintenance      WHERE is_demo = true`);
        await db.execute(sql`DELETE FROM orders           WHERE is_demo = true`);
        await db.execute(sql`DELETE FROM drivers          WHERE is_demo = true`);
        await db.execute(sql`DELETE FROM customers        WHERE is_demo = true`);
        await db.execute(sql`DELETE FROM cars             WHERE is_demo = true`);
        await db.execute(sql`DELETE FROM journal_entries  WHERE is_demo = true`);
        await db.execute(sql`DELETE FROM chart_of_accounts WHERE is_demo = true`);
        console.log('   ✅ Cleared demo rows');

        console.log('🚗 Seeding cars...');
        const insertedCars = await db
            .insert(cars)
            .values(seedCars.map((c) => ({ ...c, isDemo: true })))
            .returning();
        console.log(`   ✅ ${insertedCars.length} cars`);

        console.log('👥 Seeding customers...');
        const insertedCustomers = await db
            .insert(customers)
            .values(seedCustomers.map((c) => ({ ...c, isDemo: true })))
            .returning();
        console.log(`   ✅ ${insertedCustomers.length} customers`);

        console.log('🧑‍✈️ Seeding drivers...');
        const insertedDrivers = await db
            .insert(drivers)
            .values(seedDrivers.map((d) => ({ ...d, isDemo: true })))
            .returning();
        console.log(`   ✅ ${insertedDrivers.length} drivers`);

        console.log('📋 Seeding orders...');
        const sampleOrders = buildOrders(insertedCars, insertedCustomers, insertedDrivers);
        const insertedOrders = await db
            .insert(orders)
            .values(sampleOrders.map((o) => ({ ...o, isDemo: true })))
            .returning();
        console.log(`   ✅ ${insertedOrders.length} orders`);

        console.log('🔧 Seeding maintenance...');
        const maintenanceRecords = [
            { carId: insertedCars[6].id, type: 'routine', description: 'Servis berkala 10.000 km', scheduledDate: daysAhead(3), status: 'scheduled', cost: '750000' },
            { carId: insertedCars[7].id, type: 'repair', description: 'Ganti kampas rem depan dan belakang', scheduledDate: daysAgo(1), status: 'in_progress', cost: '1200000' },
            { carId: insertedCars[19].id, type: 'inspection', description: 'Pemeriksaan menyeluruh & perbaikan AC', scheduledDate: daysAgo(2), status: 'in_progress', cost: '1800000' },
            { carId: insertedCars[12].id, type: 'routine', description: 'Tune-up & ganti busi', scheduledDate: daysAhead(10), status: 'scheduled', cost: '650000' },
            { carId: insertedCars[3].id, type: 'routine', description: 'Servis berkala 20.000 km', scheduledDate: daysAgo(20), completedDate: daysAgo(19), status: 'completed', cost: '950000' },
        ];
        await db.insert(maintenance).values(maintenanceRecords.map((m) => ({ ...m, isDemo: true })));
        console.log(`   ✅ ${maintenanceRecords.length} maintenance records`);

        console.log('⭐ Seeding reviews...');
        const completedOrders = insertedOrders.filter((o) => o.status === 'completed');
        const sampleReviews = completedOrders.slice(0, 12).map((o) => ({
            customerId: o.customerId,
            orderId: o.id,
            rating: pick([5, 5, 5, 4, 4, 5, 4, 5]),
            comment: pick([
                'Sangat cepat responsnya! Mobil bersih dan nyaman.',
                'Armada selalu bersih dan on-time. Recommended!',
                'Harga kompetitif untuk luar kota. Pelayanan baik.',
                'Driver ramah dan profesional, perjalanan menyenangkan.',
                'Mobil prima, AC dingin, audio jernih. Akan booking lagi.',
                'Proses booking simple, mobil siap tepat waktu.',
                'Pengalaman menyenangkan, terima kasih DSR Solution!',
            ]),
        }));
        if (sampleReviews.length) {
            await db.insert(reviews).values(sampleReviews.map((r) => ({ ...r, isDemo: true })));
        }
        console.log(`   ✅ ${sampleReviews.length} reviews`);

        console.log('📒 Seeding chart of accounts...');
        await db.insert(chartOfAccounts).values(seedCoA.map((a) => ({ ...a, isDemo: true })));
        console.log(`   ✅ ${seedCoA.length} accounts`);

        console.log('💰 Seeding journal entries (6 months)...');
        const jEntries = buildJournalEntries();
        await db.insert(journalEntries).values(jEntries.map((e) => ({ ...e, isDemo: true })));
        console.log(`   ✅ ${jEntries.length} journal entries`);

        await ensureDemoUser();

        console.log('\n✅ Demo seed complete.');
        console.log('\n   🔑 Demo credentials:');
        console.log(`      email:    ${DEMO_EMAIL}`);
        console.log(`      password: ${DEMO_PASSWORD}`);
        console.log('\n   Click "Coba Demo Admin" on /admin/login to enter.');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Seed failed:', error);
        process.exit(1);
    }
}

seed();
