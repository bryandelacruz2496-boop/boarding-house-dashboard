const express = require('express');
const router = express.Router();
const { getDB } = require('../database');
const { ObjectId } = require('mongodb');

const WIFI_PER_PERSON = 200;

async function updateRoomBilling(roomId) {
  const db = getDB();
  const now = new Date();
  const month = now.toLocaleString('default', { month: 'long' }).toUpperCase();
  const year = now.getFullYear();

  const billing = await db.collection('billing').findOne({ room_id: roomId, month, year });
  if (!billing) return;

  const wifiCount = await db.collection('tenants').countDocuments({ room_id: roomId, is_active: 1, has_wifi: 1 });
  const newWifi = WIFI_PER_PERSON * wifiCount;
  const newTotal = billing.rent + newWifi + billing.electric_bill + billing.water_bill + billing.garbage_fee + billing.penalty;

  await db.collection('billing').updateOne({ _id: billing._id }, { $set: { wifi: newWifi, total: newTotal } });
}

router.get('/', async (req, res) => {
  const db = getDB();
  const rooms = await db.collection('rooms').find().sort({ room_number: 1 }).toArray();
  const roomsWithTenants = [];

  for (const room of rooms) {
    const tenants = await db.collection('tenants').find({ room_id: room._id.toString(), is_active: 1 }).sort({ name: 1 }).toArray();
    roomsWithTenants.push({ ...room, id: room._id.toString(), tenants: tenants.map(t => ({ ...t, id: t._id.toString() })) });
  }

  res.render('rooms', { rooms: roomsWithTenants });
});

router.post('/update/:id', async (req, res) => {
  const db = getDB();
  await db.collection('rooms').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: req.body.status } });
  res.redirect('/rooms');
});

router.post('/:id/tenants/add', async (req, res) => {
  const db = getDB();
  const roomId = req.params.id;
  const count = await db.collection('tenants').countDocuments({ room_id: roomId, is_active: 1 });
  if (count >= 5) return res.redirect('/rooms');

  await db.collection('tenants').insertOne({ room_id: roomId, name: req.body.name, has_wifi: 1, is_active: 1, created_at: new Date() });
  await db.collection('rooms').updateOne({ _id: new ObjectId(roomId) }, { $set: { status: 'occupied' } });
  await updateRoomBilling(roomId);
  res.redirect('/rooms');
});

router.post('/:id/tenants/remove/:tenantId', async (req, res) => {
  const db = getDB();
  const roomId = req.params.id;
  await db.collection('tenants').updateOne({ _id: new ObjectId(req.params.tenantId) }, { $set: { is_active: 0 } });

  const remaining = await db.collection('tenants').countDocuments({ room_id: roomId, is_active: 1 });
  if (remaining === 0) await db.collection('rooms').updateOne({ _id: new ObjectId(roomId) }, { $set: { status: 'vacant' } });

  await updateRoomBilling(roomId);
  res.redirect('/rooms');
});

router.post('/:id/tenants/:tenantId/wifi', async (req, res) => {
  const db = getDB();
  const tenant = await db.collection('tenants').findOne({ _id: new ObjectId(req.params.tenantId) });
  await db.collection('tenants').updateOne({ _id: tenant._id }, { $set: { has_wifi: tenant.has_wifi ? 0 : 1 } });
  await updateRoomBilling(req.params.id);
  res.redirect('/rooms');
});

module.exports = router;
