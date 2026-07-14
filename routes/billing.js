const express = require('express');
const router = express.Router();
const { getDB } = require('../database');
const { ObjectId } = require('mongodb');
const { computeRoomCollection } = require('../lib/payments');

const WIFI_PER_PERSON = 200;
const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

// Propagate a room-level settlement to each active tenant's payment record so
// the billing and computation views stay in sync.
//   paid = true  -> mark every active tenant as paid
//   paid = false -> mark every active tenant as unpaid
async function syncTenantPayments(db, billing, paid) {
  const paidFlag = paid ? 1 : 0;
  const paidDate = paid ? new Date().toISOString().split('T')[0] : null;
  const tenants = await db.collection('tenants').find({ room_id: billing.room_id, is_active: 1 }).toArray();
  for (const t of tenants) {
    const existing = await db.collection('tenant_payments').findOne({ tenant_id: t._id.toString(), billing_id: billing._id.toString() });
    if (existing) {
      await db.collection('tenant_payments').updateOne({ _id: existing._id }, { $set: { paid: paidFlag, paid_date: paidDate } });
    } else {
      await db.collection('tenant_payments').insertOne({ tenant_id: t._id.toString(), billing_id: billing._id.toString(), amount: 0, paid: paidFlag, paid_date: paidDate });
    }
  }
}

router.get('/', async (req, res) => {
  const db = getDB();
  const now = new Date();
  const month = (req.query.month || now.toLocaleString('default', { month: 'long' })).toUpperCase();
  const year = parseInt(req.query.year) || now.getFullYear();

  const rooms = await db.collection('rooms').find().sort({ room_number: 1 }).toArray();

  // Sync wifi for all unsettled billings before displaying
  const allBillings = await db.collection('billing').find({ month, year }).toArray();
  for (const billing of allBillings) {
    if (billing.payment_status === 'SETTLED') continue;
    const tenants = await db.collection('tenants').find({ room_id: billing.room_id, is_active: 1 }).toArray();
    let wifiCount = 0;
    for (const t of tenants) {
      const wifiRecord = await db.collection('tenant_wifi_monthly').findOne({ tenant_id: t._id.toString(), month, year });
      const hasWifi = wifiRecord ? wifiRecord.has_wifi : t.has_wifi;
      if (hasWifi) wifiCount++;
    }
    const correctWifi = WIFI_PER_PERSON * wifiCount;
    if (billing.wifi !== correctWifi) {
      const newTotal = billing.rent + correctWifi + billing.electric_bill + billing.water_bill + billing.garbage_fee + billing.penalty;
      await db.collection('billing').updateOne({ _id: billing._id }, { $set: { wifi: correctWifi, total: newTotal } });
      billing.wifi = correctWifi;
      billing.total = newTotal;
    }
  }

  const billings = allBillings;

  const roomBillings = [];
  for (const room of rooms) {
    const billing = billings.find(b => b.room_id === room._id.toString());
    roomBillings.push({ room: { ...room, id: room._id.toString() }, billing: billing ? { ...billing, id: billing._id.toString() } : null });
  }

  const overallTotal = billings.reduce((s, b) => s + b.total, 0);
  // Collected/outstanding from actual per-tenant payments (SETTLED flag as override)
  let totalSettled = 0, totalUnsettled = 0;
  for (const b of billings) {
    const c = await computeRoomCollection(db, b, month, year);
    totalSettled += c.collected;
    totalUnsettled += c.outstanding;
  }

  const columnTotals = {
    rent: billings.reduce((s, b) => s + b.rent, 0), wifi: billings.reduce((s, b) => s + b.wifi, 0),
    electric: billings.reduce((s, b) => s + b.electric_bill, 0), water: billings.reduce((s, b) => s + b.water_bill, 0),
    garbage: billings.reduce((s, b) => s + b.garbage_fee, 0), penalty: billings.reduce((s, b) => s + b.penalty, 0),
  };

  const monthIndex = MONTHS.indexOf(month);
  const monthNum = String(monthIndex + 1).padStart(2, '0');
  const varExpenses = await db.collection('expenses').find({ date: { $regex: `^${year}-${monthNum}` } }).toArray();
  // Only fixed expenses marked PAID for this month count against collection.
  const fixedExpenses = await db.collection('fixed_expenses').find({ is_active: 1 }).toArray();
  let paidFixedTotal = 0;
  for (const fe of fixedExpenses) {
    const payment = await db.collection('fixed_expense_payments')
      .findOne({ fixed_expense_id: fe._id.toString(), month: monthIndex + 1, year });
    if (payment && payment.paid) paidFixedTotal += fe.amount;
  }
  const totalExpenses = paidFixedTotal + varExpenses.reduce((s, e) => s + e.amount, 0);
  const netIncome = totalSettled - totalExpenses;

  res.render('billing', { roomBillings, month, year, months: MONTHS, overallTotal, totalSettled, totalUnsettled, columnTotals, totalExpenses, netIncome });
});

router.get('/edit/:roomId', async (req, res) => {
  const db = getDB();
  const now = new Date();
  const month = (req.query.month || now.toLocaleString('default', { month: 'long' })).toUpperCase();
  const year = parseInt(req.query.year) || now.getFullYear();
  const roomId = req.params.roomId;

  const room = await db.collection('rooms').findOne({ _id: new ObjectId(roomId) });
  const billingDoc = await db.collection('billing').findOne({ room_id: roomId, month, year });
  const billing = billingDoc ? { ...billingDoc, id: billingDoc._id.toString() } : null;
  const tenants = await db.collection('tenants').find({ room_id: roomId, is_active: 1 }).toArray();
  const wifiTenantCount = tenants.filter(t => t.has_wifi).length;

  // Get previous month reading
  const currentMonthIndex = MONTHS.indexOf(month);
  let prevReading = 0;
  if (currentMonthIndex > 0) {
    const prev = await db.collection('billing').findOne({ room_id: roomId, month: MONTHS[currentMonthIndex - 1], year });
    if (prev) prevReading = prev.current_reading;
  } else {
    const prev = await db.collection('billing').findOne({ room_id: roomId, month: 'DECEMBER', year: year - 1 });
    if (prev) prevReading = prev.current_reading;
  }

  res.render('billing-edit', {
    room: { ...room, id: room._id.toString() }, billing, month, year, tenants,
    tenantCount: tenants.length, wifiTenantCount, wifiPerPerson: WIFI_PER_PERSON, prevReading
  });
});

router.post('/save', async (req, res) => {
  const db = getDB();
  const { room_id, month, year, rent, water_bill, garbage_fee, penalty, payment_status, previous_reading, current_reading, rate_per_kwh } = req.body;
  
  // Always compute electric from readings to ensure consistency with computation module
  const prevReading = parseFloat(previous_reading||0);
  const currReading = parseFloat(current_reading||0);
  const rate = parseFloat(rate_per_kwh||15);
  const consumption = currReading - prevReading;
  const electric_bill = consumption > 0 ? consumption * rate : 0;

  // Always compute wifi from per-month tenant wifi data to stay in sync with rooms module
  const tenants = await db.collection('tenants').find({ room_id, is_active: 1 }).toArray();
  let wifiCount = 0;
  for (const t of tenants) {
    const wifiRecord = await db.collection('tenant_wifi_monthly').findOne({ tenant_id: t._id.toString(), month, year: parseInt(year) });
    const hasWifi = wifiRecord ? wifiRecord.has_wifi : t.has_wifi;
    if (hasWifi) wifiCount++;
  }
  const wifi = WIFI_PER_PERSON * wifiCount;

  const total = parseFloat(rent||0) + wifi + electric_bill + parseFloat(water_bill||0) + parseFloat(garbage_fee||0) + parseFloat(penalty||0);

  const data = {
    room_id, month, year: parseInt(year),
    rent: parseFloat(rent||0), wifi, electric_bill,
    water_bill: parseFloat(water_bill||0), garbage_fee: parseFloat(garbage_fee||0), penalty: parseFloat(penalty||0),
    total, previous_reading: prevReading, current_reading: currReading,
    rate_per_kwh: rate, payment_status: payment_status || 'UNSETTLED'
  };

  await db.collection('billing').updateOne(
    { room_id, month, year: parseInt(year) },
    { $set: data, $setOnInsert: { created_at: new Date() } },
    { upsert: true }
  );

  // If the room was saved as SETTLED, mark all tenant payments paid so the
  // computation view matches. (UNSETTLED is left alone to preserve any
  // partial per-tenant payments already recorded.)
  if (data.payment_status === 'SETTLED') {
    const savedBilling = await db.collection('billing').findOne({ room_id, month, year: parseInt(year) });
    if (savedBilling) await syncTenantPayments(db, savedBilling, true);
  }

  res.redirect(`/billing?month=${month}&year=${year}`);
});

router.post('/delete/:id', async (req, res) => {
  const db = getDB();
  await db.collection('tenant_payments').deleteMany({ billing_id: req.params.id });
  await db.collection('billing').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect(`/billing?month=${req.body.month}&year=${req.body.year}`);
});

router.post('/toggle-status/:id', async (req, res) => {
  const db = getDB();
  const billing = await db.collection('billing').findOne({ _id: new ObjectId(req.params.id) });
  if (billing) {
    const newStatus = billing.payment_status === 'SETTLED' ? 'UNSETTLED' : 'SETTLED';
    await db.collection('billing').updateOne({ _id: billing._id }, { $set: { payment_status: newStatus } });
    // Keep per-tenant payments in sync with the room-level status.
    await syncTenantPayments(db, billing, newStatus === 'SETTLED');
  }
  res.redirect(`/billing?month=${req.body.month}&year=${req.body.year}`);
});

module.exports = router;
