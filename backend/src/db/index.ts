import dotenv from 'dotenv';
dotenv.config();

import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set');
  console.error('Please set DATABASE_URL in backend/.env file');
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL);
export const db = drizzle(client, { schema });

// Transaction type for use in function signatures
export type DbTransaction = PostgresJsDatabase<typeof schema>;

// Helper for running transactions with automatic rollback on error
export async function withTransaction<T>(
  callback: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(callback);
}

export * from './schema';

