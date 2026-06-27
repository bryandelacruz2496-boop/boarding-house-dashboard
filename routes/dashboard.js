const express = require('express');
const router = express.Router();
const { getDB } = require('../database');

const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
const WIFI_PER_PERSON = 200;

router.get('/', async (req, res) => {
  const db = getDB();
  const now = new Date();
  const currentMonth = (req.query.month || now.toLocaleString('default', { month: 'long' })).toUpperCase();
  const currentYear = parseInt(req.query.year) || now.getFullYear();
  const monthIndex = MONTHS.indexOf(currentMonth);

  const rooms = await db.collection('rooms').find().sort({ room_number: 1 }).toArray();
  const billings = await db.collection('billing').find({ month: currentMonth, year: currentYear }).toArray();

  // Calculate totals based on per-tenant payments
  let totalCollection = 0, totalOutstanding = 0;

  for (const b of billings) {
    const tenants = await db.collection('tenants').find({ room_id: b.room_id, is_active: 1 }).toArray();
    const tc = tenants.length;
    if (tc === 0) continue;

    const consumption = b.current_reading - b.previous_reading;
    const electricBill = consumption > 0 ? consumption * b.rate_per_kwh : 0;

    for (const t of tenants) {
      const wifiCost = t.has_wifi ? WIFI_PER_PERSON : 0;
      const tenantTotal = (b.rent / tc) + wifiCost + (electricBill / tc) + (b.water_bill / tc) + (b.garbage_fee / tc) + (b.penalty / tc);
      const payment = await db.collection('tenant_payments').findOne({ tenant_id: t._id.toString(), billing_id: b._id.toString() });
      if (payment && payment.paid) totalCollection += tenantTotal;
      else totalOutstanding += tenantTotal;
    }
  }

  const settledCount = billings.filter(b => b.payment_status === 'SETTLED').length;

  // Expenses
  const monthNum = String(monthIndex + 1).padStart(2, '0');
  const expenses = await db.collection('expenses').find({
    date: { $regex: `^${currentYear}-${monthNum}` }
  }).sort({ date: -1 }).toArray();

  const fixedExpenses = await db.collection('fixed_expenses').find({ is_active: 1 }).toArray();
  const totalFixed = fixedExpenses.reduce((s, e) => s + e.amount, 0);
  const totalVariable = expenses.reduce((s, e) => s + e.amount, 0);
  const totalExpenses = totalFixed + totalVariable;
  const netIncome = totalCollection - totalExpenses;

  // Room summary
  const roomsWithTenants = [];
  for (const room of rooms) {
    const tenantCount = await db.collection('tenants').countDocuments({ room_id: room._id.toString(), is_active: 1 });
    const billing = billings.find(b => b.room_id === room._id.toString());

    let collected = 0, balance = 0;
    if (billing && tenantCount > 0) {
      const tenants = await db.collection('tenants').find({ room_id: room._id.toString(), is_active: 1 }).toArray();
      const consumption = billing.current_reading - billing.previous_reading;
      const electricBill = consumption > 0 ? consumption * billing.rate_per_kwh : 0;

      for (const t of tenants) {
        const wifiCost = t.has_wifi ? WIFI_PER_PERSON : 0;
        const tenantTotal = (billing.rent / tenantCount) + wifiCost + (electricBill / tenantCount) + (billing.water_bill / tenantCount) + (billing.garbage_fee / tenantCount) + (billing.penalty / tenantCount);
        const payment = await db.collection('tenant_payments').findOne({ tenant_id: t._id.toString(), billing_id: billing._id.toString() });
        if (payment && payment.paid) collected += tenantTotal;
        else balance += tenantTotal;
      }
    }

    roomsWithTenants.push({
      ...room, id: room._id.toString(), room_number: room.room_number, tenantCount,
      total: billing ? billing.total : 0, collected, balance,
      status: billing ? billing.payment_status : 'NO BILLING'
    });
  }

  // Expense categories
  const expenseCategories = {};
  fixedExpenses.forEach(fe => { expenseCategories[fe.name] = (expenseCategories[fe.name] || 0) + fe.amount; });
  expenses.forEach(exp => { expenseCategories[exp.reason] = (expenseCategories[exp.reason] || 0) + exp.amount; });

  const billingBreakdown = {
    rent: billings.reduce((s, b) => s + b.rent, 0),
    wifi: billings.reduce((s, b) => s + b.wifi, 0),
    electric: billings.reduce((s, b) => s + b.electric_bill, 0),
    water: billings.reduce((s, b) => s + b.water_bill, 0),
    garbage: billings.reduce((s, b) => s + b.garbage_fee, 0),
    penalty: billings.reduce((s, b) => s + b.penalty, 0),
  };

  res.render('dashboard', {
    currentMonth, currentYear, months: MONTHS, billings,
    totalCollection, totalOutstanding, settledCount, totalExpenses, netIncome,
    expenses, roomSummary: roomsWithTenants, expenseCategories, billingBreakdown
  });
});

module.exports = router;
