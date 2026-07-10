const express = require('express');
const router = express.Router();
const { getDB } = require('../database');
const { computeRoomCollection } = require('../lib/payments');

const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
const WIFI_PER_PERSON = 200;

// Lightweight financial summary for a given month/year (used for trends + sparkline)
async function computeMonthlyFinancials(db, month, year) {
  const monthIndex = MONTHS.indexOf(month);
  const billings = await db.collection('billing').find({ month, year }).toArray();

  let totalCollection = 0, totalOutstanding = 0;
  for (const b of billings) {
    const c = await computeRoomCollection(db, b, month, year);
    totalCollection += c.collected;
    totalOutstanding += c.outstanding;
  }

  const monthNum = String(monthIndex + 1).padStart(2, '0');
  const expenses = await db.collection('expenses').find({ date: { $regex: `^${year}-${monthNum}` } }).toArray();
  const fixedExpenses = await db.collection('fixed_expenses').find({ is_active: 1 }).toArray();
  const totalExpenses = fixedExpenses.reduce((s, e) => s + e.amount, 0) + expenses.reduce((s, e) => s + e.amount, 0);

  return { totalCollection, totalOutstanding, totalExpenses, netIncome: totalCollection - totalExpenses };
}

// Percentage change helper; returns null when previous is 0 (no baseline)
function pctChange(current, previous) {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

router.get('/', async (req, res) => {
  const db = getDB();
  const now = new Date();
  const currentMonth = (req.query.month || now.toLocaleString('default', { month: 'long' })).toUpperCase();
  const currentYear = parseInt(req.query.year) || now.getFullYear();
  const monthIndex = MONTHS.indexOf(currentMonth);

  const rooms = await db.collection('rooms').find().sort({ room_number: 1 }).toArray();
  const billings = await db.collection('billing').find({ month: currentMonth, year: currentYear }).toArray();

  // Calculate totals from actual per-tenant payments (with room-level SETTLED override)
  let totalCollection = 0, totalOutstanding = 0;
  const collectionByRoom = {};

  for (const b of billings) {
    const c = await computeRoomCollection(db, b, currentMonth, currentYear);
    totalCollection += c.collected;
    totalOutstanding += c.outstanding;
    collectionByRoom[b.room_id] = c;
  }

  const settledCount = Object.values(collectionByRoom).filter(c => c.status === 'SETTLED').length;

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
    const c = collectionByRoom[room._id.toString()] || { collected: 0, outstanding: billing ? billing.total : 0, status: billing ? 'UNSETTLED' : 'NO BILLING' };

    roomsWithTenants.push({
      ...room, id: room._id.toString(), room_number: room.room_number, tenantCount,
      total: billing ? billing.total : 0, collected: c.collected, balance: c.outstanding,
      status: billing ? c.status : 'NO BILLING'
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

  // Previous month (for trend indicators on KPI cards)
  let prevMonthIndex = monthIndex - 1;
  let prevYear = currentYear;
  if (prevMonthIndex < 0) { prevMonthIndex = 11; prevYear = currentYear - 1; }
  const prev = await computeMonthlyFinancials(db, MONTHS[prevMonthIndex], prevYear);

  const trends = {
    collection: pctChange(totalCollection, prev.totalCollection),
    outstanding: pctChange(totalOutstanding, prev.totalOutstanding),
    expenses: pctChange(totalExpenses, prev.totalExpenses),
    netIncome: pctChange(netIncome, prev.netIncome)
  };

  // Last 6 months of net income (for sparkline), oldest -> newest
  const sparkline = [];
  for (let i = 5; i >= 0; i--) {
    let mi = monthIndex - i;
    let yr = currentYear;
    while (mi < 0) { mi += 12; yr -= 1; }
    const fin = (mi === monthIndex && yr === currentYear)
      ? { netIncome }
      : await computeMonthlyFinancials(db, MONTHS[mi], yr);
    sparkline.push({ label: MONTHS[mi].slice(0, 3), value: fin.netIncome });
  }

  res.render('dashboard', {
    currentMonth, currentYear, months: MONTHS, billings,
    totalCollection, totalOutstanding, settledCount, totalExpenses, netIncome,
    expenses, roomSummary: roomsWithTenants, expenseCategories, billingBreakdown,
    trends, sparkline, totalRooms: rooms.length
  });
});

module.exports = router;
