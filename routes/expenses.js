const express = require('express');
const router = express.Router();
const { getDB } = require('../database');
const { ObjectId } = require('mongodb');

router.get('/', async (req, res) => {
  const db = getDB();
  const now = new Date();
  const month = parseInt(req.query.month) || (now.getMonth() + 1);
  const year = parseInt(req.query.year) || now.getFullYear();
  const monthNum = String(month).padStart(2, '0');

  const expenses = await db.collection('expenses').find({ date: { $regex: `^${year}-${monthNum}` } }).sort({ date: -1 }).toArray();
  const fixedExpenses = await db.collection('fixed_expenses').find({ is_active: 1 }).sort({ name: 1 }).toArray();

  const fixedWithStatus = [];
  for (const fe of fixedExpenses) {
    const payment = await db.collection('fixed_expense_payments').findOne({ fixed_expense_id: fe._id.toString(), month, year });
    fixedWithStatus.push({ ...fe, id: fe._id.toString(), paid: payment ? payment.paid : 0, paid_date: payment ? payment.paid_date : null });
  }

  const totalFixed = fixedExpenses.reduce((s, e) => s + e.amount, 0);
  const totalPaid = fixedWithStatus.filter(f => f.paid).reduce((s, e) => s + e.amount, 0);
  const totalUnpaid = totalFixed - totalPaid;
  const totalVariable = expenses.reduce((s, e) => s + e.amount, 0);
  const totalExpenses = totalFixed + totalVariable;

  res.render('expenses', { expenses: expenses.map(e => ({ ...e, id: e._id.toString() })), fixedExpenses: fixedWithStatus, totalFixed, totalPaid, totalUnpaid, totalVariable, totalExpenses, month, year });
});

router.post('/add', async (req, res) => {
  const db = getDB();
  const { date, amount, reason } = req.body;
  await db.collection('expenses').insertOne({ date, amount: parseFloat(amount), reason, created_at: new Date() });
  const d = new Date(date);
  res.redirect(`/expenses?month=${d.getMonth() + 1}&year=${d.getFullYear()}`);
});

router.post('/delete/:id', async (req, res) => {
  const db = getDB();
  await db.collection('expenses').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect(`/expenses?month=${req.body.month}&year=${req.body.year}`);
});

router.post('/fixed/add', async (req, res) => {
  const db = getDB();
  await db.collection('fixed_expenses').insertOne({ name: req.body.name, amount: parseFloat(req.body.amount), is_active: 1, created_at: new Date() });
  res.redirect(`/expenses?month=${req.body.month}&year=${req.body.year}`);
});

router.post('/fixed/update/:id', async (req, res) => {
  const db = getDB();
  await db.collection('fixed_expenses').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { name: req.body.name, amount: parseFloat(req.body.amount) } });
  res.redirect(`/expenses?month=${req.body.month}&year=${req.body.year}`);
});

router.post('/fixed/delete/:id', async (req, res) => {
  const db = getDB();
  await db.collection('fixed_expense_payments').deleteMany({ fixed_expense_id: req.params.id });
  await db.collection('fixed_expenses').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect(`/expenses?month=${req.body.month}&year=${req.body.year}`);
});

router.post('/fixed/toggle-paid/:id', async (req, res) => {
  const db = getDB();
  const fixedId = req.params.id;
  const month = parseInt(req.body.month);
  const year = parseInt(req.body.year);

  const existing = await db.collection('fixed_expense_payments').findOne({ fixed_expense_id: fixedId, month, year });
  if (existing) {
    const newPaid = existing.paid ? 0 : 1;
    await db.collection('fixed_expense_payments').updateOne({ _id: existing._id }, { $set: { paid: newPaid, paid_date: newPaid ? new Date().toISOString().split('T')[0] : null } });
  } else {
    await db.collection('fixed_expense_payments').insertOne({ fixed_expense_id: fixedId, month, year, paid: 1, paid_date: new Date().toISOString().split('T')[0] });
  }
  res.redirect(`/expenses?month=${req.body.month}&year=${req.body.year}`);
});

module.exports = router;
