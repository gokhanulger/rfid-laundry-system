#!/bin/bash

echo "🔌 Database Connection Setup"
echo "=============================="
echo ""
echo "Option 1: Use Neon (Free Cloud Database) - RECOMMENDED"
echo "  1. Go to https://neon.tech"
echo "  2. Sign up for free account"
echo "  3. Create a new project"
echo "  4. Copy the connection string"
echo ""
echo "Option 2: Install Local PostgreSQL"
echo "  Run: brew install postgresql@14"
echo ""

read -p "Do you have a Neon connection string? (y/n): " has_neon

if [ "$has_neon" = "y" ] || [ "$has_neon" = "Y" ]; then
    echo ""
    read -p "Paste your Neon connection string: " neon_url
    
    if [ -n "$neon_url" ]; then
        # Update .env file
        cd backend
        if [ -f .env ]; then
            # Replace DATABASE_URL line
            if [[ "$OSTYPE" == "darwin"* ]]; then
                # macOS
                sed -i '' "s|DATABASE_URL=.*|DATABASE_URL=$neon_url|" .env
            else
                # Linux
                sed -i "s|DATABASE_URL=.*|DATABASE_URL=$neon_url|" .env
            fi
            echo "✅ Updated backend/.env with your connection string"
            echo ""
            echo "Next steps:"
            echo "  1. Test connection: cd backend && npm run db:test"
            echo "  2. Run migrations: cd backend && npm run db:migrate"
            echo "  3. Seed database: cd backend && npm run db:seed"
        else
            echo "❌ backend/.env file not found"
        fi
    else
        echo "❌ No connection string provided"
    fi
else
    echo ""
    echo "📝 To get a Neon connection string:"
    echo "  1. Visit: https://neon.tech"
    echo "  2. Sign up (free)"
    echo "  3. Create project"
    echo "  4. Copy connection string from dashboard"
    echo "  5. Run this script again"
    echo ""
    echo "Or install PostgreSQL locally:"
    echo "  brew install postgresql@14"
    echo "  brew services start postgresql@14"
    echo "  createdb rfid_laundry"
fi

