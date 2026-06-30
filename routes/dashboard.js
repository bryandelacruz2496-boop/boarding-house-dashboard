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

  // Calculate totals based on billing payment_status (consistent with billing page)
  let totalCollection = 0, totalOutstanding = 0;

  for (const b of billings) {
    if (b.payment_status === 'SETTLED') {
      totalCollection += b.total;
    } else {
      totalOutstanding += b.total;
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
    if (billing) {
      if (billing.payment_status === 'SETTLED') {
        collected = billing.total;
        balance = 0;
      } else {
        collected = 0;
        balance = billing.total;
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
