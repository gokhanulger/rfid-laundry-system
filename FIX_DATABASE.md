# Fix Database Connection (500 Error)

## The Problem
Your `DATABASE_URL` is set to a placeholder that doesn't work. You need a real PostgreSQL database.

## Quick Fix - Option 1: Use Neon (Free Cloud Database) ⭐ RECOMMENDED

1. **Go to https://neon.tech** and create a free account
2. **Create a new project** (takes 30 seconds)
3. **Copy the connection string** - it looks like:
   ```
   postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
   ```
4. **Update `backend/.env`:**
   ```bash
   cd backend
   # Edit .env and replace DATABASE_URL with your Neon connection string
   ```
5. **Test the connection:**
   ```bash
   npm run db:test
   ```
6. **Run migrations:**
   ```bash
   npm run db:generate
   npm run db:migrate
   ```
7. **Create test users:**
   ```bash
   npm run db:seed
   ```

## Option 2: Use Local PostgreSQL

1. **Install PostgreSQL:**
   ```bash
   # macOS with Homebrew
   brew install postgresql@14
   brew services start postgresql@14
   ```

2. **Create database:**
   ```bash
   createdb rfid_laundry
   ```

3. **Update `backend/.env`:**
   ```
   DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/rfid_laundry
   ```
   (Replace `yourpassword` with your PostgreSQL password)

4. **Test connection:**
   ```bash
   npm run db:test
   ```

5. **Run migrations and seed:**
   ```bash
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

## After Setting Up Database

Once the database is connected:

1. **Restart the backend:**
   ```bash
   cd backend
   npm run dev
   ```

2. **Try logging in again** at http://localhost:3000/login
   - Email: `admin@laundry.com`
   - Password: `admin123`

## Verify It's Working

```bash
# Test database connection
cd backend
npm run db:test

# Should show: ✅ Database connection successful!
```

If you see that message, your database is ready!

