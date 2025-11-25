# Setup Guide

## Prerequisites

- Node.js 18+ installed
- PostgreSQL database (or Neon account)
- npm or yarn package manager

## Installation Steps

### 1. Install Dependencies

```bash
# Install root dependencies
npm install

# Install frontend dependencies
cd frontend && npm install

# Install backend dependencies
cd ../backend && npm install
```

### 2. Database Setup

1. Create a PostgreSQL database (or use Neon)
2. Copy the environment example file:
   ```bash
   cp backend/.env.example backend/.env
   ```
3. Edit `backend/.env` and add your database connection string:
   ```
   DATABASE_URL=postgresql://user:password@host/database?sslmode=require
   ```

### 3. Run Database Migrations

```bash
cd backend
npm run db:generate  # Generate migration files
npm run db:migrate   # Run migrations
```

### 4. Start Development Servers

From the root directory:
```bash
npm run dev
```

This will start both frontend (http://localhost:3000) and backend (http://localhost:3001) servers.

Or start them separately:

```bash
# Terminal 1 - Frontend
cd frontend && npm run dev

# Terminal 2 - Backend
cd backend && npm run dev
```

## First User Setup

You'll need to create the first admin user. You can do this by:

1. Using the registration endpoint (if enabled)
2. Or manually inserting into the database
3. Or creating a seed script

## Project Structure

```
RFID/
├── frontend/          # React + TypeScript frontend
│   ├── src/
│   │   ├── pages/   # All page components
│   │   ├── components/ # Reusable components
│   │   ├── contexts/ # React contexts (Auth, etc.)
│   │   └── App.tsx   # Main app component
│   └── package.json
├── backend/          # Express.js + TypeScript backend
│   ├── src/
│   │   ├── db/       # Database schema and connection
│   │   ├── routes/   # API routes
│   │   ├── middleware/ # Auth middleware
│   │   └── index.ts  # Server entry point
│   └── package.json
└── README.md
```

## Environment Variables

### Backend (.env)

- `PORT` - Server port (default: 3001)
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Secret for session encryption
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` - Email configuration
- `FRONTEND_URL` - Frontend URL for CORS

## Troubleshooting

### Database Connection Issues
- Verify your DATABASE_URL is correct
- Check if your database allows connections from your IP
- For Neon, ensure SSL mode is enabled

### Port Already in Use
- Change the PORT in backend/.env
- Or kill the process using the port

### Migration Errors
- Ensure database exists and is accessible
- Check DATABASE_URL is correct
- Try running migrations again

## Next Steps

1. Create your first admin user
2. Set up tenants (hotels)
3. Create item types
4. Start adding items with RFID tags
5. Test the workflow!

