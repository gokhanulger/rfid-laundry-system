# RFID Laundry Tracking System - Deployment Guide

## Quick Overview
- **Frontend**: React + Vite (builds to static files)
- **Backend**: Express.js + Node.js
- **Database**: Neon PostgreSQL (already configured)

---

## Option 1: Railway + Vercel (Easiest - Free Tier Available)

### Step 1: Push to GitHub
```bash
cd /Users/gokhanulger/Desktop/RFID
git init
git add .
git commit -m "Initial commit"
gh repo create rfid-laundry --public --source=. --push
```

### Step 2: Deploy Backend to Railway
1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your `rfid-laundry` repo
5. Set root directory: `backend`
6. Add these environment variables:
   ```
   DATABASE_URL=postgresql://neondb_owner:npg_nAHxzwc8lLg0@ep-quiet-hill-ahv16d1i-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
   SESSION_SECRET=your-super-secure-session-secret-change-this
   NODE_ENV=production
   PORT=3001
   FRONTEND_URL=https://your-frontend.vercel.app
   ```
7. Railway will auto-deploy. Note the URL (e.g., `https://rfid-backend.railway.app`)

### Step 3: Deploy Frontend to Vercel
1. Go to https://vercel.com
2. Sign up with GitHub
3. Click "Add New" → "Project"
4. Import your `rfid-laundry` repo
5. Configure:
   - Framework Preset: Vite
   - Root Directory: `frontend`
   - Build Command: `npm run build`
   - Output Directory: `dist`
6. Add environment variable:
   ```
   VITE_API_URL=https://your-railway-backend-url.railway.app
   ```
7. Click "Deploy"

---

## Option 2: DigitalOcean Droplet ($6/month)

### Step 1: Create Droplet
1. Go to https://digitalocean.com
2. Create a Droplet: Ubuntu 22.04, $6/month (Basic)
3. Add SSH key
4. Note your IP address

### Step 2: Initial Server Setup
```bash
# SSH into server
ssh root@YOUR_SERVER_IP

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 (process manager)
npm install -g pm2

# Install Nginx
apt install -y nginx

# Install certbot for SSL
apt install -y certbot python3-certbot-nginx

# Create app directory
mkdir -p /var/www/rfid-laundry
cd /var/www/rfid-laundry
```

### Step 3: Upload Your Code
From your local machine:
```bash
# Create a zip of the project
cd /Users/gokhanulger/Desktop/RFID
zip -r rfid-laundry.zip . -x "node_modules/*" -x "*/node_modules/*" -x ".git/*"

# Upload to server
scp rfid-laundry.zip root@YOUR_SERVER_IP:/var/www/rfid-laundry/

# On server
cd /var/www/rfid-laundry
unzip rfid-laundry.zip
```

### Step 4: Setup Backend
```bash
cd /var/www/rfid-laundry/backend

# Install dependencies
npm install

# Create production .env
cat > .env << 'EOF'
PORT=3001
NODE_ENV=production
DATABASE_URL=postgresql://neondb_owner:npg_nAHxzwc8lLg0@ep-quiet-hill-ahv16d1i-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
SESSION_SECRET=your-super-secure-session-secret-change-this-in-production
FRONTEND_URL=https://yourdomain.com
EOF

# Build TypeScript
npm run build

# Start with PM2
pm2 start dist/index.js --name "rfid-backend"
pm2 save
pm2 startup
```

### Step 5: Build Frontend
```bash
cd /var/www/rfid-laundry/frontend

# Install dependencies
npm install

# Create .env for production API URL
echo "VITE_API_URL=https://yourdomain.com/api" > .env.production

# Build
npm run build

# Move build to nginx directory
cp -r dist /var/www/rfid-frontend
```

### Step 6: Configure Nginx
```bash
cat > /etc/nginx/sites-available/rfid-laundry << 'EOF'
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Frontend
    location / {
        root /var/www/rfid-frontend;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        rewrite ^/api(.*)$ $1 break;
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Enable site
ln -s /etc/nginx/sites-available/rfid-laundry /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default

# Test and reload
nginx -t
systemctl reload nginx
```

### Step 7: Add SSL (Free with Let's Encrypt)
```bash
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

---

## Option 3: Docker Deployment

### docker-compose.yml (create in project root)
```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - SESSION_SECRET=${SESSION_SECRET}
      - FRONTEND_URL=${FRONTEND_URL}
    restart: always

  frontend:
    build: ./frontend
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: always
```

### Backend Dockerfile (backend/Dockerfile)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

### Frontend Dockerfile (frontend/Dockerfile)
```dockerfile
FROM node:20-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

---

## Post-Deployment Checklist

1. **Update CORS**: Make sure backend allows your production domain
2. **Database**: Run migrations if needed
   ```bash
   npm run db:migrate
   ```
3. **Test Login**: Default credentials (check LOGIN_INFO.md)
4. **SSL**: Ensure HTTPS is working
5. **Environment Variables**: Double-check all are set correctly

---

## Domain Setup

1. Buy a domain (Namecheap, Google Domains, Cloudflare)
2. Point DNS A record to your server IP
3. Wait for DNS propagation (5-30 minutes)
4. Run certbot for SSL

---

## Monitoring (Optional)

- **PM2**: `pm2 monit` - Monitor your backend
- **Logs**: `pm2 logs rfid-backend`
- **UptimeRobot**: Free monitoring service

---

## Cost Estimates

| Option | Monthly Cost |
|--------|-------------|
| Railway + Vercel (Free tier) | $0 |
| Railway + Vercel (Hobby) | $5-10 |
| DigitalOcean Droplet | $6 |
| Hetzner VPS | $4 |

Your Neon database is already set up and free for small usage!
