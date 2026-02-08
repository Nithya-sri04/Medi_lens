import { getDb } from '../config/mongodb.js';
import { ObjectId } from 'mongodb';

const OTP_COLLECTION = 'otp_email';
const USERS_COLLECTION = 'users';
const PRESCRIPTIONS_COLLECTION = 'saved_prescriptions';

/** Ensure indexes exist (run once). Ignores conflict if an index on the same key already exists (e.g. email_1). */
async function ensureIndexes() {
  const db = await getDb();
  const createIfMissing = async (collection, keys, options) => {
    try {
      await db.collection(collection).createIndex(keys, options);
    } catch (err) {
      if (err.code === 85 || err.code === 86) return; // IndexOptionsConflict / IndexKeySpecsConflict – index on key already exists
      throw err;
    }
  };
  await createIfMissing(OTP_COLLECTION, { email: 1 }, { unique: true, name: 'idx_otp_email_email' });
  await createIfMissing(USERS_COLLECTION, { email: 1 }, { unique: true, name: 'idx_users_email' });
  await createIfMissing(PRESCRIPTIONS_COLLECTION, { user_id: 1, created_at: -1 }, { name: 'idx_prescriptions_user_created' });
}

let indexesEnsured = false;
async function ensureIndexesOnce() {
  if (!indexesEnsured) {
    await ensureIndexes();
    indexesEnsured = true;
  }
}

// --- OTP (email) ---

export async function setOtpEmail(email, code, expiresAt, name) {
  await ensureIndexesOnce();
  const db = await getDb();
  const normalized = String(email || '').trim().toLowerCase();
  await db.collection(OTP_COLLECTION).updateOne(
    { email: normalized },
    { $set: { email: normalized, code, expires_at: expiresAt, name: name || '' } },
    { upsert: true }
  );
}

export async function getOtpByEmail(email) {
  const db = await getDb();
  const normalized = String(email || '').trim().toLowerCase();
  return db.collection(OTP_COLLECTION).findOne({ email: normalized });
}

// --- Users (email-only) ---

export async function upsertUserByEmail(email, name) {
  await ensureIndexesOnce();
  const db = await getDb();
  const normalized = String(email || '').trim().toLowerCase();
  const now = new Date();
  const existing = await db.collection(USERS_COLLECTION).findOne({ email: normalized });
  if (existing) {
    await db.collection(USERS_COLLECTION).updateOne(
      { email: normalized },
      { $set: { name, updated_at: now } }
    );
    return { id: existing._id.toString(), name, email: existing.email };
  }
  const res = await db.collection(USERS_COLLECTION).insertOne({
    email: normalized,
    name: name || 'User',
    created_at: now,
    updated_at: now,
  });
  return { id: res.insertedId.toString(), name: name || 'User', email: normalized };
}

// --- Saved prescriptions ---

export async function listPrescriptionsByUserId(userId) {
  const db = await getDb();
  const list = await db
    .collection(PRESCRIPTIONS_COLLECTION)
    .find({ user_id: userId })
    .sort({ created_at: -1 })
    .project({ title: 1, description: 1, created_at: 1 })
    .toArray();
  return list.map((doc) => ({
    id: doc._id.toString(),
    title: doc.title,
    description: doc.description,
    created_at: doc.created_at
  }));
}

function withId(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...rest, id: _id.toString() };
}

export async function createPrescription(userId, title, description, data) {
  const db = await getDb();
  const now = new Date();
  const res = await db.collection(PRESCRIPTIONS_COLLECTION).insertOne({
    user_id: userId,
    title: title || 'Prescription',
    description: description || '',
    data,
    created_at: now,
    updated_at: now
  });
  return { id: res.insertedId.toString(), title: title || 'Prescription', description: description || '', created_at: now };
}

export async function getPrescriptionByIdAndUser(id, userId) {
  const db = await getDb();
  let oid;
  try {
    oid = new ObjectId(id);
  } catch {
    return null;
  }
  const doc = await db.collection(PRESCRIPTIONS_COLLECTION).findOne({ _id: oid, user_id: userId });
  return withId(doc);
}

export async function updatePrescriptionByIdAndUser(id, userId, updates) {
  const db = await getDb();
  let oid;
  try {
    oid = new ObjectId(id);
  } catch {
    return null;
  }
  const res = await db.collection(PRESCRIPTIONS_COLLECTION).findOneAndUpdate(
    { _id: oid, user_id: userId },
    { $set: { ...updates, updated_at: new Date() } },
    { returnDocument: 'after' }
  );
  if (!res) return null;
  return { id: res._id.toString(), title: res.title, description: res.description, updated_at: res.updated_at };
}

export async function deletePrescriptionByIdAndUser(id, userId) {
  const db = await getDb();
  let oid;
  try {
    oid = new ObjectId(id);
  } catch {
    return false;
  }
  const result = await db.collection(PRESCRIPTIONS_COLLECTION).deleteOne({ _id: oid, user_id: userId });
  return result.deletedCount === 1;
}
