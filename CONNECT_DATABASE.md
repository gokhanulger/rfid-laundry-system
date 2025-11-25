# Connect Database - Step by Step Guide

## 🚀 Quick Setup with Neon (Recommended - 2 minutes)

### Step 1: Get Free Database
1. Go to **https://neon.tech**
2. Click **"Sign Up"** (free account)
3. Click **"Create Project"**
4. Choose a name (e.g., "rfid-laundry")
5. Click **"Create Project"**

### Step 2: Copy Connection String
1. In your Neon dashboard, you'll see a connection string
2. It looks like: `postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require`
3. Click **"Copy"** button next to it

### Step 3: Update Your .env File

**Option A: Use the setup script**
```bash
./setup-database.sh
# When prompted, paste your connection string
```

**Option B: Manual update**
```bash
cd backend
# Edit .env file and replace the DATABASE_URL line with your Neon connection string
```

### Step 4: Test Connection
```bash
cd backend
npm run db:test
```

You should see: ✅ **Database connection successful!**

### Step 5: Set Up Database Tables
```bash
cd backend
npm run db:generate  # Generate migration files
npm run db:migrate  # Create tables
```

### Step 6: Create Test Users
```bash
cd backend
npm run db:seed
```

This creates:
- admin@laundry.com / admin123
- manager@laundry.com / manager123
- owner@hotel.com / owner123
- operator@laundry.com / operator123

### Step 7: Restart Backend
```bash
cd backend
npm run dev
```

### Step 8: Test Login
Go to http://localhost:3000/login and use:
- Email: `admin@laundry.com`
- Password: `admin123`

---

## 🖥️ Alternative: Local PostgreSQL

If you prefer to use local PostgreSQL:

### Install PostgreSQL
```bash
# macOS
brew install postgresql@14
brew services start postgresql@14

# Create database
createdb rfid_laundry
```

### Update .env
```bash
cd backend
# Edit .env and set:
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/rfid_laundry
```

Then follow steps 4-8 above.

---

## ✅ Verify Everything Works

```bash
# 1. Test connection
cd backend && npm run db:test

# 2. Check tables exist
# (You can use Neon's SQL editor or psql)

# 3. Try login at http://localhost:3000/login
```

---

## 🆘 Troubleshooting

**"Database connection failed"**
- Check your connection string is correct
- Ensure you copied the entire string including `?sslmode=require`
- For Neon, make sure SSL is enabled

**"Tables don't exist"**
- Run: `npm run db:migrate`

**"No users found"**
- Run: `npm run db:seed`

**Still getting 500 error?**
- Check backend terminal for error messages
- Verify DATABASE_URL in backend/.env
- Restart backend after changing .env

