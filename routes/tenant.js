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
  const roomId = req.session.room_id;

  if (!roomId) return res.redirect('/login');

  const room = await db.collection('rooms').findOne({ _id: new ObjectId(roomId) });
  const tenants = await db.collection('tenants').find({ room_id: roomId, is_active: 1 }).sort({ name: 1 }).toArray();
  const billing = await db.collection('billing').findOne({ room_id: roomId, month, year });

  let tenantBreakdowns = [];
  let consumption = 0;
  let roomTotal = 0;

  if (billing && tenants.length > 0) {
    const tenantCount = tenants.length;
    consumption = billing.current_reading - billing.previous_reading;
    const electricBill = consumption > 0 ? consumption * billing.rate_per_kwh : 0;
    const rentShare = billing.rent / tenantCount;
    const electricShare = electricBill / tenantCount;
    const waterShare = billing.water_bill / tenantCount;
    const garbageShare = billing.garbage_fee / tenantCount;
    const penaltyShare = billing.penalty / tenantCount;

    for (const tenant of tenants) {
      const wifiRecord = await db.collection('tenant_wifi_monthly').findOne({ tenant_id: tenant._id.toString(), month, year });
      const hasWifi = wifiRecord ? wifiRecord.has_wifi : tenant.has_wifi;
      const wifiCost = hasWifi ? WIFI_PER_PERSON : 0;
      const total = rentShare + wifiCost + electricShare + waterShare + garbageShare + penaltyShare;
      const payment = await db.collection('tenant_payments').findOne({ tenant_id: tenant._id.toString(), billing_id: billing._id.toString() });

      tenantBreakdowns.push({
        name: tenant.name,
        rentShare, wifiCost, electricShare, waterShare, garbageShare, penaltyShare, total,
        paid: payment ? payment.paid : 0
      });
      roomTotal += total;
    }
  }

  // Payment history (last 6 months)
  const paymentHistory = [];
  for (let i = 0; i < 6; i++) {
    const mIndex = MONTHS.indexOf(month) - i;
    let hMonth, hYear;
    if (mIndex >= 0) {
      hMonth = MONTHS[mIndex];
      hYear = year;
    } else {
      hMonth = MONTHS[12 + mIndex];
      hYear = year - 1;
    }
    const hBilling = await db.collection('billing').findOne({ room_id: roomId, month: hMonth, year: hYear });
    if (hBilling) {
      paymentHistory.push({
        month: hMonth, year: hYear,
        total: hBilling.total,
        status: hBilling.payment_status
      });
    }
  }

  res.render('tenant-portal', {
    room, tenants, billing, tenantBreakdowns, consumption, roomTotal,
    month, year, months: MONTHS, paymentHistory
  });
});

module.exports = router;
