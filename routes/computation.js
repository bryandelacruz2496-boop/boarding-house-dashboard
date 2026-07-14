const express = require('express');
const router = express.Router();
const { getDB } = require('../database');
const { ObjectId } = require('mongodb');

const WIFI_PER_PERSON = 200;
const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

router.get('/', async (req, res) => {
  const db = getDB();
  const now = new Date();
  const month = (req.query.month || now.toLocaleString('default', { month: 'long' })).toUpperCase();
  const year = parseInt(req.query.year) || now.getFullYear();

  const rooms = await db.collection('rooms').find().sort({ room_number: 1 }).toArray();
  const roomComputations = [];

  for (const room of rooms) {
    const roomId = room._id.toString();
    const tenants = await db.collection('tenants').find({ room_id: roomId, is_active: 1 }).sort({ name: 1 }).toArray();
    const billing = await db.collection('billing').findOne({ room_id: roomId, month, year });

    const tenantCount = tenants.length;

    // Count wifi subscribers from per-month data
    let wifiTenantCount = 0;
    for (const t of tenants) {
      const wifiRecord = await db.collection('tenant_wifi_monthly').findOne({ tenant_id: t._id.toString(), month, year });
      const hasWifi = wifiRecord ? wifiRecord.has_wifi : t.has_wifi;
      if (hasWifi) wifiTenantCount++;
    }

    if (!billing || tenantCount === 0) {
      roomComputations.push({ room: { ...room, id: roomId }, tenants, tenantCount, wifiTenantCount, billing: null });
      continue;
    }

    const consumption = billing.current_reading - billing.previous_reading;
    const electricBill = consumption > 0 ? consumption * billing.rate_per_kwh : 0;
    const rentShare = billing.rent / tenantCount;
    const electricShare = electricBill / tenantCount;
    const waterShare = billing.water_bill / tenantCount;
    const garbageShare = billing.garbage_fee / tenantCount;
    const penaltyShare = billing.penalty / tenantCount;

    // Room-level SETTLED is a manual override: every tenant is considered paid
    // even if their individual tenant_payments record hasn't been set.
    const roomSettled = billing.payment_status === 'SETTLED';

    const tenantBreakdowns = [];
    for (const tenant of tenants) {
      // Use per-month wifi status
      const wifiRecord = await db.collection('tenant_wifi_monthly').findOne({ tenant_id: tenant._id.toString(), month, year });
      const hasWifi = wifiRecord ? wifiRecord.has_wifi : tenant.has_wifi;
      const wifiCost = hasWifi ? WIFI_PER_PERSON : 0;
      const total = rentShare + wifiCost + electricShare + waterShare + garbageShare + penaltyShare;
      const payment = await db.collection('tenant_payments').findOne({ tenant_id: tenant._id.toString(), billing_id: billing._id.toString() });

      const paid = roomSettled ? 1 : (payment ? payment.paid : 0);
      tenantBreakdowns.push({
        ...tenant, id: tenant._id.toString(), rentShare, wifiCost, electricShare, waterShare, garbageShare, penaltyShare, total,
        paid, paid_date: payment ? payment.paid_date : null
      });
    }

    roomComputations.push({
      room: { ...room, id: roomId }, tenants: tenantBreakdowns, tenantCount, wifiTenantCount,
      billing: { ...billing, id: billing._id.toString() }, consumption
    });
  }

  const totalAllTenants = roomComputations.reduce((s, rc) => {
    if (rc.billing) return s + rc.tenants.reduce((ts, t) => ts + (t.total || 0), 0);
    return s;
  }, 0);

  const totalPaidByTenants = roomComputations.reduce((s, rc) => {
    if (rc.billing) return s + rc.tenants.filter(t => t.paid).reduce((ts, t) => ts + (t.total || 0), 0);
    return s;
  }, 0);

  res.render('computation', { roomComputations, month, year, months: MONTHS, wifiPerPerson: WIFI_PER_PERSON, totalAllTenants, totalPaidByTenants });
});

router.post('/toggle-pay/:tenantId/:billingId', async (req, res) => {
  const db = getDB();
  const { month, year } = req.body;
  const tenantId = req.params.tenantId;
  const billingId = req.params.billingId;

  const existing = await db.collection('tenant_payments').findOne({ tenant_id: tenantId, billing_id: billingId });
  if (existing) {
    const newPaid = existing.paid ? 0 : 1;
    await db.collection('tenant_payments').updateOne({ _id: existing._id }, { $set: { paid: newPaid, paid_date: newPaid ? new Date().toISOString().split('T')[0] : null } });
  } else {
    await db.collection('tenant_payments').insertOne({ tenant_id: tenantId, billing_id: billingId, amount: 0, paid: 1, paid_date: new Date().toISOString().split('T')[0] });
  }

  // Auto-settle check
  const billing = await db.collection('billing').findOne({ _id: new ObjectId(billingId) });
  if (billing) {
    const activeTenants = await db.collection('tenants').find({ room_id: billing.room_id, is_active: 1 }).toArray();
    let allPaid = true;
    for (const t of activeTenants) {
      const tp = await db.collection('tenant_payments').findOne({ tenant_id: t._id.toString(), billing_id: billingId });
      if (!tp || !tp.paid) { allPaid = false; break; }
    }
    await db.collection('billing').updateOne({ _id: billing._id }, { $set: { payment_status: allPaid ? 'SETTLED' : 'UNSETTLED' } });
  }

  res.redirect(`/computation?month=${month}&year=${year}`);
});

router.get('/receipt/:roomId/:tenantId', async (req, res) => {
  const db = getDB();
  const month = (req.query.month || new Date().toLocaleString('default', { month: 'long' })).toUpperCase();
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const roomId = req.params.roomId;

  const room = await db.collection('rooms').findOne({ _id: new ObjectId(roomId) });
  const tenant = await db.collection('tenants').findOne({ _id: new ObjectId(req.params.tenantId) });
  const billing = await db.collection('billing').findOne({ room_id: roomId, month, year });
  const allTenants = await db.collection('tenants').find({ room_id: roomId, is_active: 1 }).toArray();
  const tenantCount = allTenants.length;

  if (!room || !tenant || !billing || tenantCount === 0) return res.redirect(`/computation?month=${month}&year=${year}`);

  const consumption = billing.current_reading - billing.previous_reading;
  const electricBill = consumption > 0 ? consumption * billing.rate_per_kwh : 0;
  const rentShare = billing.rent / tenantCount;
  const electricShare = electricBill / tenantCount;
  const waterShare = billing.water_bill / tenantCount;
  const garbageShare = billing.garbage_fee / tenantCount;
  const penaltyShare = billing.penalty / tenantCount;
  const wifiRecord = await db.collection('tenant_wifi_monthly').findOne({ tenant_id: tenant._id.toString(), month, year });
  const hasWifi = wifiRecord ? wifiRecord.has_wifi : tenant.has_wifi;
  const wifiCost = hasWifi ? WIFI_PER_PERSON : 0;
  const total = rentShare + wifiCost + electricShare + waterShare + garbageShare + penaltyShare;

  res.render('receipt', { room, tenant, billing, month, year, tenantCount, consumption, rentShare, electricShare, waterShare, garbageShare, penaltyShare, wifiCost, total, wifiPerPerson: WIFI_PER_PERSON });
});

router.get('/receipt/:roomId', async (req, res) => {
  const db = getDB();
  const month = (req.query.month || new Date().toLocaleString('default', { month: 'long' })).toUpperCase();
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const roomId = req.params.roomId;

  const room = await db.collection('rooms').findOne({ _id: new ObjectId(roomId) });
  const billing = await db.collection('billing').findOne({ room_id: roomId, month, year });
  const tenants = await db.collection('tenants').find({ room_id: roomId, is_active: 1 }).sort({ name: 1 }).toArray();
  const tenantCount = tenants.length;

  if (!room || !billing || tenantCount === 0) return res.redirect(`/computation?month=${month}&year=${year}`);

  const consumption = billing.current_reading - billing.previous_reading;
  const electricBill = consumption > 0 ? consumption * billing.rate_per_kwh : 0;
  const rentShare = billing.rent / tenantCount;
  const electricShare = electricBill / tenantCount;
  const waterShare = billing.water_bill / tenantCount;
  const garbageShare = billing.garbage_fee / tenantCount;
  const penaltyShare = billing.penalty / tenantCount;

  const tenantBreakdownsAsync = [];
  for (const t of tenants) {
    const wifiRecord = await db.collection('tenant_wifi_monthly').findOne({ tenant_id: t._id.toString(), month, year });
    const hasWifi = wifiRecord ? wifiRecord.has_wifi : t.has_wifi;
    const wifiCost = hasWifi ? WIFI_PER_PERSON : 0;
    const total = rentShare + wifiCost + electricShare + waterShare + garbageShare + penaltyShare;
    tenantBreakdownsAsync.push({ ...t, rentShare, wifiCost, electricShare, waterShare, garbageShare, penaltyShare, total });
  }

  const roomTotal = tenantBreakdownsAsync.reduce((s, t) => s + t.total, 0);
  res.render('receipt-room', { room, billing, month, year, tenants: tenantBreakdownsAsync, tenantCount, consumption, roomTotal, wifiPerPerson: WIFI_PER_PERSON });
});

module.exports = router;
