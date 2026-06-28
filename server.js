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

// Make user available in all views
app.use((req, res, next) => {
  res.locals.user = req.session.userId ? { id: req.session.userId, username: req.session.username } : null;
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/api', require('./routes/api'));
app.use('/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/billing', requireAuth, require('./routes/billing'));
app.use('/expenses', requireAuth, require('./routes/expenses'));
app.use('/rooms', requireAuth, require('./routes/rooms'));
app.use('/computation', requireAuth, require('./routes/computation'));

// Root redirect
app.get('/', (req, res) => {
  if (req.session.userId) res.redirect('/dashboard');
  else res.redirect('/login');
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

// Start server after DB connects
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Boarding House Dashboard running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});
