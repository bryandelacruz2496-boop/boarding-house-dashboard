require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { connectDB } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'default-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.role !== 'tenant') return next();
  if (req.session && req.session.role === 'tenant') return res.redirect('/tenant');
  res.redirect('/login');
}

function requireTenant(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'tenant') return next();
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  res.redirect('/login');
}

// Make user available in all views
app.use((req, res, next) => {
  res.locals.user = req.session.userId ? { id: req.session.userId, username: req.session.username, role: req.session.role, room_id: req.session.room_id } : null;
  next();
});

// Force password change middleware
app.use(async (req, res, next) => {
  if (req.session.userId && 
      req.path !== '/change-password' && 
      req.path !== '/logout' && 
      req.path !== '/login' &&
      req.path !== '/health' &&
      !req.path.startsWith('/css') && 
      !req.path.startsWith('/js')) {
    const { getDB } = require('./database');
    const { ObjectId } = require('mongodb');
    const db = getDB();
    if (db) {
      const user = await db.collection('users').findOne({ _id: new ObjectId(req.session.userId) });
      if (user && user.role === 'tenant' && user.must_change_password !== false) {
        return res.redirect('/change-password');
      }
    }
  }
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/api', require('./routes/api'));
app.use('/dashboard', requireAdmin, require('./routes/dashboard'));
app.use('/billing', requireAdmin, require('./routes/billing'));
app.use('/expenses', requireAdmin, require('./routes/expenses'));
app.use('/rooms', requireAdmin, require('./routes/rooms'));
app.use('/computation', requireAdmin, require('./routes/computation'));
app.use('/tenant', requireTenant, require('./routes/tenant'));

// Root redirect
app.get('/', (req, res) => {
  if (req.session.userId) {
    if (req.session.role === 'tenant') return res.redirect('/tenant');
    return res.redirect('/dashboard');
  }
  res.redirect('/login');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Self-ping to prevent Render free tier from sleeping
setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  fetch(`${url}/health`).catch(() => {});
}, 5 * 60 * 1000); // every 5 minutes

// Auto-penalty: Add ₱250 to unsettled billings after the 12th of each month
const PENALTY_AMOUNT = 250;

async function applyLatePenalties() {
  try {
    const { getDB } = require('./database');
    const db = getDB();
    if (!db) return;

    const now = new Date();
    const currentDay = now.getDate();
    if (currentDay <= 12) return; // Not past due date yet

    const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    const currentMonth = MONTHS[now.getMonth()];
    const currentYear = now.getFullYear();

    // Find all unsettled billings for the current month that haven't been penalized yet
    const unsettledBillings = await db.collection('billing').find({
      month: currentMonth,
      year: currentYear,
      payment_status: 'UNSETTLED',
      penalty_applied: { $ne: true }
    }).toArray();

    for (const billing of unsettledBillings) {
      const newPenalty = billing.penalty + PENALTY_AMOUNT;
      const newTotal = billing.rent + billing.wifi + billing.electric_bill + billing.water_bill + billing.garbage_fee + newPenalty;
      await db.collection('billing').updateOne(
        { _id: billing._id },
        { $set: { penalty: newPenalty, total: newTotal, penalty_applied: true } }
      );
    }

    if (unsettledBillings.length > 0) {
      console.log(`[Penalty] Applied ₱${PENALTY_AMOUNT} penalty to ${unsettledBillings.length} unsettled billing(s) for ${currentMonth} ${currentYear}`);
    }
  } catch (err) {
    console.error('[Penalty] Error applying penalties:', err.message);
  }
}

// Run penalty check every hour
setInterval(applyLatePenalties, 60 * 60 * 1000);
// Also run on startup (in case server was down during the 12th)
setTimeout(applyLatePenalties, 10000);

// Start server after DB connects
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Boarding House Dashboard running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});
