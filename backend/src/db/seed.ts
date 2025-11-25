import { db } from './index';
import { users, tenants, itemTypes, items } from './schema';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

async function seed() {
  try {
    console.log('🌱 Starting database seed...');

    // Create a default tenant (hotel) for testing
    const [defaultTenant] = await db.insert(tenants).values({
      name: 'Demo Hotel',
      email: 'demo@hotel.com',
      phone: '+1234567890',
      address: '123 Demo Street',
    }).returning();

    console.log('✅ Created default tenant:', defaultTenant.name);

    // Create item types
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

    const createdItemTypes = await db.insert(itemTypes).values(itemTypesData).returning();
    console.log('✅ Created', createdItemTypes.length, 'item types');

    // Create sample items with RFID tags
    const sampleItems = [];
    const statuses = ['at_hotel', 'at_laundry', 'processing', 'ready_for_delivery'] as const;

    for (let i = 1; i <= 50; i++) {
      const itemType = createdItemTypes[i % createdItemTypes.length];
      const status = statuses[i % statuses.length];
      sampleItems.push({
        rfidTag: `RFID-${String(i).padStart(6, '0')}`,
        itemTypeId: itemType.id,
        tenantId: defaultTenant.id,
        status,
        location: status === 'at_hotel' ? 'Room ' + (100 + (i % 10)) : 'Laundry Facility',
      });
    }

    const createdItems = await db.insert(items).values(sampleItems).returning();
    console.log('✅ Created', createdItems.length, 'sample items');

    // Create admin user
    const adminPassword = 'admin123'; // Change this in production!
    const adminPasswordHash = await bcrypt.hash(adminPassword, 10);

    const [adminUser] = await db.insert(users).values({
      email: 'admin@laundry.com',
      passwordHash: adminPasswordHash,
      firstName: 'System',
      lastName: 'Admin',
      role: 'system_admin',
      tenantId: null, // Admin has no tenant
    }).returning();

    console.log('✅ Created admin user:', adminUser.email);
    console.log('   Password: admin123');

    // Create a laundry manager user
    const managerPassword = 'manager123';
    const managerPasswordHash = await bcrypt.hash(managerPassword, 10);

    const [managerUser] = await db.insert(users).values({
      email: 'manager@laundry.com',
      passwordHash: managerPasswordHash,
      firstName: 'Laundry',
      lastName: 'Manager',
      role: 'laundry_manager',
      tenantId: null,
    }).returning();

    console.log('✅ Created manager user:', managerUser.email);
    console.log('   Password: manager123');

    // Create a hotel owner user
    const ownerPassword = 'owner123';
    const ownerPasswordHash = await bcrypt.hash(ownerPassword, 10);

    const [ownerUser] = await db.insert(users).values({
      email: 'owner@hotel.com',
      passwordHash: ownerPasswordHash,
      firstName: 'Hotel',
      lastName: 'Owner',
      role: 'hotel_owner',
      tenantId: defaultTenant.id,
    }).returning();

    console.log('✅ Created hotel owner user:', ownerUser.email);
    console.log('   Password: owner123');

    // Create an operator user
    const operatorPassword = 'operator123';
    const operatorPasswordHash = await bcrypt.hash(operatorPassword, 10);

    const [operatorUser] = await db.insert(users).values({
      email: 'operator@laundry.com',
      passwordHash: operatorPasswordHash,
      firstName: 'Laundry',
      lastName: 'Operator',
      role: 'operator',
      tenantId: null,
    }).returning();

    console.log('✅ Created operator user:', operatorUser.email);
    console.log('   Password: operator123');

    // Create a driver user
    const driverPassword = 'driver123';
    const driverPasswordHash = await bcrypt.hash(driverPassword, 10);

    const [driverUser] = await db.insert(users).values({
      email: 'driver@laundry.com',
      passwordHash: driverPasswordHash,
      firstName: 'Delivery',
      lastName: 'Driver',
      role: 'driver',
      tenantId: null,
    }).returning();

    console.log('✅ Created driver user:', driverUser.email);
    console.log('   Password: driver123');

    console.log('\n🎉 Seed completed successfully!');
    console.log('\n📋 Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('System Admin:');
    console.log('  Email: admin@laundry.com');
    console.log('  Password: admin123');
    console.log('\nLaundry Manager:');
    console.log('  Email: manager@laundry.com');
    console.log('  Password: manager123');
    console.log('\nHotel Owner:');
    console.log('  Email: owner@hotel.com');
    console.log('  Password: owner123');
    console.log('\nOperator:');
    console.log('  Email: operator@laundry.com');
    console.log('  Password: operator123');
    console.log('\nDriver:');
    console.log('  Email: driver@laundry.com');
    console.log('  Password: driver123');
    console.log('\n📦 Sample Data:');
    console.log('  - 10 Item Types (Bed Sheet, Towel, etc.)');
    console.log('  - 50 Sample Items with RFID tags (RFID-000001 to RFID-000050)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

seed();

