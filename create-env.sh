#!/bin/bash
# Script to create .env file for backend

cat > backend/.env << 'EOF'
# Server
PORT=3001
NODE_ENV=development

# Database (Neon PostgreSQL)
# TODO: Replace with your actual database connection string
DATABASE_URL=postgresql://user:password@localhost:5432/rfid_laundry?sslmode=disable

# Session
SESSION_SECRET=dev-session-secret-change-in-production-12345

# Email (Nodemailer) - Optional for testing
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@laundrytracking.com

# Frontend URL
FRONTEND_URL=http://localhost:3000
EOF

echo ".env file created in backend/.env"
echo "Please update DATABASE_URL with your actual database connection string"

