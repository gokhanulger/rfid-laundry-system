import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    console.error('❌ DATABASE_URL is not set in .env file');
    process.exit(1);
  }

  console.log('Testing database connection...');
  console.log('URL:', dbUrl.replace(/:[^:@]+@/, ':****@')); // Hide password

  try {
    const sql = neon(dbUrl);
    const result = await sql`SELECT 1 as test`;
    console.log('✅ Database connection successful!');
    console.log('Result:', result);
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Database connection failed!');
    console.error('Error:', error.message);
    console.error('\nPossible issues:');
    console.error('1. Database server is not running');
    console.error('2. DATABASE_URL credentials are incorrect');
    console.error('3. Database does not exist');
    console.error('4. Network/firewall blocking connection');
    process.exit(1);
  }
}

testConnection();

