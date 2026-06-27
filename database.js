const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const dns = require('dns');

// Fix for ISPs that don't support SRV DNS lookups
dns.setServers(['8.8.8.8', '8.8.4.4']);

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('ERROR: MONGODB_URI environment variable is required');
  process.exit(1);
}
const DB_NAME = 'boarding_house';

let db;
let client;

async function connectDB() {
  if (db) return db;
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('Connected to MongoDB Atlas');

  // Create indexes
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('rooms').createIndex({ room_number: 1 }, { unique: true });
  await db.collection('tenants').createIndex({ room_id: 1, is_active: 1 });
  await db.collection('billing').createIndex({ room_id: 1, month: 1, year: 1 }, { unique: true });
  await db.collection('tenant_payments').createIndex({ tenant_id: 1, billing_id: 1 }, { unique: true });
  await db.collection('fixed_expense_payments').createIndex({ fixed_expense_id: 1, month: 1, year: 1 }, { unique: true });

  // Seed admin user
  const admin = await db.collection('users').findOne({ username: 'admin' });
  if (!admin) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
    await db.collection('users').insertOne({ username: 'admin', password: hash, role: 'admin', created_at: new Date() });
  }

  // Seed 10 rooms
  const roomCount = await db.collection('rooms').countDocuments();
  if (roomCount === 0) {
    const rooms = [];
    for (let i = 1; i <= 10; i++) rooms.push({ room_number: i, status: 'vacant' });
    await db.collection('rooms').insertMany(rooms);
  }

  // Seed fixed expenses
  const fixedCount = await db.collection('fixed_expenses').countDocuments();
  if (fixedCount === 0) {
    await db.collection('fixed_expenses').insertMany([
      { name: 'Apartment Rent', amount: 30000, is_active: 1, created_at: new Date() },
      { name: 'WiFi Monthly Payment', amount: 1750, is_active: 1, created_at: new Date() },
      { name: 'Caretaker Salary', amount: 5000, is_active: 1, created_at: new Date() },
    ]);
  }

  return db;
}

function getDB() { return db; }

module.exports = { connectDB, getDB };
