# Troubleshooting Login Issues

## Common Issues and Solutions

### 1. Backend Not Running

**Symptoms:** Login fails with "Cannot connect to server" or network error

**Solution:**
```bash
# Check if backend is running
lsof -ti:3001

# If not running, start it:
cd backend
npm run dev
```

### 2. Database Connection Failed

**Symptoms:** Backend crashes on startup or login returns 500 error

**Check:**
1. Verify DATABASE_URL in `backend/.env` is correct
2. Ensure database is running and accessible
3. Check database credentials

**Solution:**
```bash
# Update backend/.env with correct database URL
# Format: postgresql://user:password@host:port/database?sslmode=require

# For local PostgreSQL:
DATABASE_URL=postgresql://postgres:password@localhost:5432/rfid_laundry

# For Neon (cloud):
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
```

### 3. No Users in Database

**Symptoms:** Login returns "Invalid credentials" even with correct email/password

**Solution:**
```bash
# Run migrations first
cd backend
npm run db:generate
npm run db:migrate

# Then seed the database with test users
npm run db:seed
```

### 4. Database Migrations Not Run

**Symptoms:** Tables don't exist, causing errors

**Solution:**
```bash
cd backend
npm run db:generate  # Generate migration files
npm run db:migrate   # Apply migrations to database
```

### 5. Session/Cookie Issues

**Symptoms:** Login succeeds but immediately logged out

**Check:**
- Frontend and backend URLs match in .env
- CORS is configured correctly
- Cookies are enabled in browser

## Quick Diagnostic Steps

1. **Check Backend Status:**
   ```bash
   curl http://localhost:3001/api/health
   ```
   Should return: `{"status":"ok","timestamp":"..."}`

2. **Check Frontend Status:**
   ```bash
   curl http://localhost:3000
   ```
   Should return HTML

3. **Check Database Connection:**
   ```bash
   # Test PostgreSQL connection (if local)
   psql -h localhost -U postgres -d rfid_laundry
   ```

4. **Check Backend Logs:**
   Look at the terminal where `npm run dev` is running for error messages

## Test Login Credentials

After running `npm run db:seed`:

- **Admin:** admin@laundry.com / admin123
- **Manager:** manager@laundry.com / manager123
- **Owner:** owner@hotel.com / owner123
- **Operator:** operator@laundry.com / operator123

## Still Having Issues?

1. Check browser console (F12) for errors
2. Check backend terminal for error messages
3. Verify all environment variables are set correctly
4. Ensure database is accessible from your network

