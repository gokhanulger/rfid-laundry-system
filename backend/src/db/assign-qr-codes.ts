import { db } from './index';
import { tenants } from './schema';
import { eq, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

// Generate a unique QR code for hotel
function generateQRCode(): string {
  return `HTL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function assignQRCodes() {
  try {
    console.log('🏷️  Assigning QR codes to hotels without one...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Find tenants without QR codes
    const tenantsWithoutQR = await db.query.tenants.findMany({
      where: isNull(tenants.qrCode),
    });

    if (tenantsWithoutQR.length === 0) {
      console.log('✅ All hotels already have QR codes!');

      // Show all hotels with their QR codes
      const allTenants = await db.query.tenants.findMany({
        columns: {
          name: true,
          qrCode: true,
        }
      });

      console.log('\n📋 Hotel QR Codes:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      allTenants.forEach(t => {
        console.log(`  ${t.name}: ${t.qrCode}`);
      });
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      process.exit(0);
    }

    console.log(`Found ${tenantsWithoutQR.length} hotels without QR codes\n`);

    for (const tenant of tenantsWithoutQR) {
      const qrCode = generateQRCode();
      await db.update(tenants)
        .set({ qrCode, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
      console.log(`✅ ${tenant.name}: ${qrCode}`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n🎉 QR codes assigned to ${tenantsWithoutQR.length} hotels!`);

    // Show all hotels with their QR codes
    const allTenants = await db.query.tenants.findMany({
      columns: {
        name: true,
        qrCode: true,
      }
    });

    console.log('\n📋 All Hotel QR Codes:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    allTenants.forEach(t => {
      console.log(`  ${t.name}: ${t.qrCode}`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to assign QR codes:', error);
    process.exit(1);
  }
}

assignQRCodes();
