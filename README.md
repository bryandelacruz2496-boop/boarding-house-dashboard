# Boarding House Dashboard

A complete boarding house management system with billing, expenses tracking, and room management.

## Features

- **Admin Login** - Secure authentication
- **Dashboard** - Monthly overview (total collection, outstanding balances, expenses)
- **Billing** - Per-room monthly billing (Rent, WiFi, Electric, Water, Garbage Fee, Penalty)
- **Expenses** - Track boarding house expenses
- **Room Management** - 10 rooms with tenant info and occupancy status

## Tech Stack

- Node.js + Express
- EJS Templates
- SQLite (better-sqlite3)
- CSS (no frameworks)

## Setup

```bash
npm install
npm start
```

Open http://localhost:3000

## Default Login

- Username: `admin`
- Password: `admin123`

## Environment Variables

Copy `.env.example` or create `.env`:

```
PORT=3000
SESSION_SECRET=your-secret-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

## Deploy to Render

1. Push to GitHub
2. Create a new Web Service on Render
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Add environment variables
