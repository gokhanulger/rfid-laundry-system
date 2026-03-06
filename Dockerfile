FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/

# Install dependencies
RUN npm ci --workspace=backend --include-workspace-root

# Copy backend source
COPY backend/ ./backend/

# Build - only compile TypeScript, skip db:migrate (needs DATABASE_URL at runtime)
RUN cd backend && npx tsc

# Start - run migrations then start server
WORKDIR /app/backend
CMD ["sh", "-c", "npm run db:migrate && node dist/index.js"]
