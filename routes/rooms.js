const express = require('express');
const router = express.Router();
const { getDB } = require('../database');
const { ObjectId } = require('mongodb');

const WIFI_PER_PERSON = 200;
const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

async function getWifiStatus(tenantId, month, year) {
  const db = getDB();
  const record = await db.collection('tenant_wifi_monthly').findOne({ tenant_id: tenantId, month, year });
  if (record) return record.has_wifi;
  // Fallback to tenant's default has_wifi
  const tenant = await db.collection('tenants').findOne({ _id: new ObjectId(tenantId) });
  return tenant ? tenant.has_wifi : 0;
}

async function updateRoomBilling(roomId, month, year) {
  const db = getDB();

  const billing = await db.collection('billing').findOne({ room_id: roomId, month, year, payment_status: { $ne: 'SETTLED' } });
  if (!billing) return;

  const tenants = await db.collection('tenants').find({ room_id: roomId, is_active: 1 }).toArray();
  let wifiCount = 0;
  for (const t of tenants) {
    const wifiStatus = await getWifiStatus(t._id.toString(), month, year);
    if (wifiStatus) wifiCount++;
  }

  const newWifi = WIFI_PER_PERSON * wifiCount;
  const newTotal = billing.rent + newWifi + billing.electric_bill + billing.water_bill + billing.garbage_fee + billing.penalty;
  await db.collection('billing').updateOne({ _id: billing._id }, { $set: { wifi: newWifi, total: newTotal } });
}

router.get('/', async (req, res) => {
  const db = getDB();
  const now = new Date();
  const month = (req.query.month || now.toLocaleString('default', { month: 'long' })).toUpperCase();
  const year = parseInt(req.query.year) || now.getFullYear();

  const rooms = await db.collection('rooms').find().sort({ room_number: 1 }).toArray();
  const roomsWithTenants = [];

  for (const room of rooms) {
    const tenants = await db.collection('tenants').find({ room_id: room._id.toString(), is_active: 1 }).sort({ name: 1 }).toArray();
    const tenantsWithWifi = [];
    for (const t of tenants) {
      const wifiStatus = await getWifiStatus(t._id.toString(), month, year);
      tenantsWithWifi.push({ ...t, id: t._id.toString(), has_wifi: wifiStatus });
    }
    // Check if room has a tenant account
    const account = await db.collection('users').findOne({ room_id: room._id.toString(), role: 'tenant' });
    roomsWithTenants.push({ ...room, id: room._id.toString(), tenants: tenantsWithWifi, account: account ? { username: account.username } : null });
  }

  res.render('rooms', { rooms: roomsWithTenants, month, year, months: MONTHS });
});

router.post('/update/:id', async (req, res) => {
  const db = getDB();
  const { month, year } = req.body;
  await db.collection('rooms').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: req.body.status } });
  res.redirect(`/rooms?month=${month}&year=${year}`);
});

router.post('/:id/tenants/add', async (req, res) => {
  const db = getDB();
  const roomId = req.params.id;
  const { name, month, year } = req.body;
  const count = await db.collection('tenants').countDocuments({ room_id: roomId, is_active: 1 });
  if (count >= 5) return res.redirect(`/rooms?month=${month}&year=${year}`);

  const result = await db.collection('tenants').insertOne({ room_id: roomId, name, has_wifi: 1, is_active: 1, created_at: new Date() });
  await db.collection('rooms').updateOne({ _id: new ObjectId(roomId) }, { $set: { status: 'occupied' } });

  // Set wifi ON for this month
  await db.collection('tenant_wifi_monthly').updateOne(
    { tenant_id: result.insertedId.toString(), month, year: parseInt(year) },
    { $set: { has_wifi: 1 } },
    { upsert: true }
  );

  await updateRoomBilling(roomId, month, parseInt(year));
  res.redirect(`/rooms?month=${month}&year=${year}`);
});

router.post('/:id/tenants/remove/:tenantId', async (req, res) => {
  const db = getDB();
  const roomId = req.params.id;
  const { month, year } = req.body;
  await db.collection('tenants').updateOne({ _id: new ObjectId(req.params.tenantId) }, { $set: { is_active: 0 } });

  const remaining = await db.collection('tenants').countDocuments({ room_id: roomId, is_active: 1 });
  if (remaining === 0) await db.collection('rooms').updateOne({ _id: new ObjectId(roomId) }, { $set: { status: 'vacant' } });

  await updateRoomBilling(roomId, month, parseInt(year));
  res.redirect(`/rooms?month=${month}&year=${year}`);
});

router.post('/:id/tenants/:tenantId/wifi', async (req, res) => {
  const db = getDB();
  const { month, year } = req.body;
  const tenantId = req.params.tenantId;
  const roomId = req.params.id;

  // Get current wifi status for this month
  const currentStatus = await getWifiStatus(tenantId, month, parseInt(year));
  const newStatus = currentStatus ? 0 : 1;

  // Save per-month wifi status
  await db.collection('tenant_wifi_monthly').updateOne(
    { tenant_id: tenantId, month, year: parseInt(year) },
    { $set: { has_wifi: newStatus } },
    { upsert: true }
  );

  // Also update the tenant's default (for new months)
  await db.collection('tenants').updateOne({ _id: new ObjectId(tenantId) }, { $set: { has_wifi: newStatus } });

  await updateRoomBilling(roomId, month, parseInt(year));
  res.redirect(`/rooms?month=${month}&year=${year}`);
});

// Room account management
router.post('/:id/account/create', async (req, res) => {
  const db = getDB();
  const bcrypt = require('bcryptjs');
  const roomId = req.params.id;
  const { username, password, month, year } = req.body;

  // Check if account already exists for this room
  const existing = await db.collection('users').findOne({ room_id: roomId, role: 'tenant' });
  if (existing) {
    return res.redirect(`/rooms?month=${month}&year=${year}`);
  }

  const hash = bcrypt.hashSync(password, 10);
  await db.collection('users').insertOne({
    username,
    password: hash,
    role: 'tenant',
    room_id: roomId,
    must_change_password: true,
    created_at: new Date()
  });

  res.redirect(`/rooms?month=${month}&year=${year}`);
});

router.post('/:id/account/reset', async (req, res) => {
  const db = getDB();
  const bcrypt = require('bcryptjs');
  const roomId = req.params.id;
  const { password, month, year } = req.body;

  const hash = bcrypt.hashSync(password, 10);
  await db.collection('users').updateOne(
    { room_id: roomId, role: 'tenant' },
    { $set: { password: hash, must_change_password: true } }
  );

  res.redirect(`/rooms?month=${month}&year=${year}`);
});

router.post('/:id/account/delete', async (req, res) => {
  const db = getDB();
  const roomId = req.params.id;
  const { month, year } = req.body;

  await db.collection('users').deleteOne({ room_id: roomId, role: 'tenant' });
  res.redirect(`/rooms?month=${month}&year=${year}`);
});

module.exports = router;
