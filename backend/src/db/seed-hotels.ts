import { db } from './index';
import { users, tenants, itemTypes, items } from './schema';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

// Hotel names
const hotelNames = [
  { name: 'Grand Palace Hotel', city: 'Istanbul' },
  { name: 'Seaside Resort & Spa', city: 'Antalya' },
  { name: 'Mountain View Lodge', city: 'Bursa' },
  { name: 'City Center Suites', city: 'Ankara' },
  { name: 'Luxury Beach Hotel', city: 'Bodrum' },
  { name: 'Historic Inn & Suites', city: 'Izmir' },
  { name: 'Royal Garden Hotel', city: 'Istanbul' },
  { name: 'Sunset Bay Resort', city: 'Marmaris' },
  { name: 'Alpine Heights Hotel', city: 'Uludag' },
  { name: 'Riverside Boutique Hotel', city: 'Fethiye' },
  { name: 'Metropolitan Grand', city: 'Istanbul' },
  { name: 'Coastal Paradise Resort', city: 'Kusadasi' },
  { name: 'Heritage Palace Hotel', city: 'Cappadocia' },
  { name: 'Marina Bay Suites', city: 'Cesme' },
  { name: 'Golden Tulip Hotel', city: 'Ankara' },
  { name: 'Emerald Coast Resort', city: 'Alanya' },
  { name: 'Crystal Tower Hotel', city: 'Istanbul' },
  { name: 'Sapphire Beach Club', city: 'Side' },
  { name: 'Diamond Plaza Hotel', city: 'Izmir' },
  { name: 'Pearl Bay Resort', city: 'Kas' },
];

async function seedHotels() {
  try {
    console.log('🏨 Starting hotel seed...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Check if item types exist, if not create them
    let existingItemTypes = await db.query.itemTypes.findMany();

    if (existingItemTypes.length === 0) {
      console.log('Creating item types...');
      const itemTypesData = [
        { name: 'Bed Sheet', description: 'Standard bed sheets' },
        { name: 'Pillow Case', description: 'Standard pillow cases' },
        { name: 'Towel', description: 'Bath towels' },
        { name: 'Hand Towel', description: 'Hand towels' },
        { name: 'Bath Mat', description: 'Bathroom mats' },
        { name: 'Duvet Cover', description: 'Duvet covers' },
        { name: 'Blanket', description: 'Blankets' },
        { name: 'Table Cloth', description: 'Table cloths' },
        { name: 'Napkin', description: 'Cloth napkins' },
        { name: 'Bathrobe', description: 'Guest bathrobes' },
      ];
      existingItemTypes = await db.insert(itemTypes).values(itemTypesData).returning();
      console.log('✅ Created', existingItemTypes.length, 'item types');
    }

    // Password hash for hotel owners
    const ownerPasswordHash = await bcrypt.hash('hotel123', 10);

    const statuses = ['at_hotel', 'at_laundry', 'processing', 'ready_for_delivery', 'in_transit'] as const;
    let totalItems = 0;
    let rfidCounter = 1000;

    // Create each hotel
    for (let h = 0; h < hotelNames.length; h++) {
      const hotel = hotelNames[h];

      // Create tenant (hotel)
      const [newTenant] = await db.insert(tenants).values({
        name: hotel.name,
        email: `contact@${hotel.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
        phone: `+90${String(5000000000 + h * 1111111).slice(0, 10)}`,
        address: `${100 + h} Main Street, ${hotel.city}, Turkey`,
      }).returning();

      // Create hotel owner user
      const emailSlug = hotel.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
      await db.insert(users).values({
        email: `owner@${emailSlug}.com`,
        passwordHash: ownerPasswordHash,
        firstName: hotel.name.split(' ')[0],
        lastName: 'Manager',
        role: 'hotel_owner',
        tenantId: newTenant.id,
      });

      // Generate random number of items per hotel (50-200)
      const itemCount = 50 + Math.floor(Math.random() * 150);
      const hotelItems = [];

      for (let i = 0; i < itemCount; i++) {
        const itemType = existingItemTypes[Math.floor(Math.random() * existingItemTypes.length)];
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        const washCount = Math.floor(Math.random() * 80); // 0-80 washes
        const isDamaged = Math.random() < 0.03; // 3% chance of being damaged
        const isStained = Math.random() < 0.05; // 5% chance of being stained

        // Create random date within last 6 months for item age
        const createdDaysAgo = Math.floor(Math.random() * 180);
        const createdAt = new Date();
        createdAt.setDate(createdAt.getDate() - createdDaysAgo);

        hotelItems.push({
          rfidTag: `RFID-${String(rfidCounter++).padStart(6, '0')}`,
          itemTypeId: itemType.id,
          tenantId: newTenant.id,
          status,
          washCount,
          isDamaged,
          isStained,
          location: status === 'at_hotel' ? `Room ${100 + Math.floor(Math.random() * 400)}` : 'Laundry Facility',
          createdAt,
          updatedAt: new Date(),
        });
      }

      await db.insert(items).values(hotelItems);
      totalItems += itemCount;

      console.log(`✅ ${hotel.name} (${hotel.city}): ${itemCount} items`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n🎉 Seed completed!`);
    console.log(`   - ${hotelNames.length} Hotels created`);
    console.log(`   - ${totalItems} Total items created`);
    console.log(`   - ${existingItemTypes.length} Item types`);

    console.log('\n📋 Hotel Owner Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Password for all hotel owners: hotel123');
    console.log('\nExample logins:');
    hotelNames.slice(0, 5).forEach(hotel => {
      const emailSlug = hotel.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
      console.log(`  ${hotel.name}: owner@${emailSlug}.com`);
    });
    console.log('  ... and more');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

seedHotels();
