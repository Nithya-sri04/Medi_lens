import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || 'medilens';

let client = null;
let db = null;

export function isMongoConnectionError(err) {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    msg.includes('mongoserverselectionerror') ||
    msg.includes('ssl') ||
    msg.includes('tls') ||
    msg.includes('replicasetnoprimary') ||
    msg.includes('server selection') ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT'
  );
}

/**
 * Get MongoDB database instance. Connects on first call.
 */
export async function getDb() {
  if (db) return db;
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not set. Add it to your .env for auth (login + saved prescriptions).');
  }
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  return db;
}

/**
 * Close MongoDB connection (e.g. on app shutdown).
 */
export async function closeMongoConnection() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
