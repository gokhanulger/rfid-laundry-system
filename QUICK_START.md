# Quick Start Guide - Fix Login Issues

## Step 1: Check Backend is Running

```bash
# Check if backend is running on port 3001
curl http://localhost:3001/api/health
```

If this fails, start the backend:
```bash
cd backend
npm run dev
```

## Step 2: Set Up Database

You need a PostgreSQL database. Options:

### Option A: Use Neon (Free Cloud Database)
1. Go to https://neon.tech
2. Create a free account and database
3. Copy the connection string
4. Update `backend/.env`:
   ```
   DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
   ```

### Option B: Use Local PostgreSQL
1. Install PostgreSQL locally
2. Create a database:
   ```bash
   createdb rfid_laundry
   ```
3. Update `backend/.env`:
   ```
   DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/rfid_laundry
   ```

## Step 3: Run Database Migrations

```bash
cd backend
npm run db:generate  # Generate migration files
npm run db:migrate   # Create tables in database
```

## Step 4: Create Test Users

```bash
cd backend
npm run db:seed
```

This creates:
- **admin@laundry.com** / **admin123**
- **manager@laundry.com** / **manager123**
- **owner@hotel.com** / **owner123**
- **operator@laundry.com** / **operator123**

## Step 5: Test Login

1. Open http://localhost:3000/login
2. Use one of the credentials above
3. You should be logged in!

## Common Errors

### "Cannot connect to server"
- Backend is not running
- Start it: `cd backend && npm run dev`

### "Database connection failed"
- Check DATABASE_URL in `backend/.env`
- Ensure database is running and accessible
- Verify credentials are correct

### "Invalid credentials"
- Users don't exist in database
- Run: `cd backend && npm run db:seed`

### "Tables don't exist"
- Migrations not run
- Run: `cd backend && npm run db:migrate`

