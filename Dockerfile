FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/

# Install dependencies
RUN npm ci --workspace=backend --include-workspace-root

# Copy backend source
COPY backend/ ./backend/

# Build - compile TypeScript AND copy non-TS assets (fonts for PDF). Uses the
# package.json "build" script (tsc + copy src/fonts -> dist/fonts), skip db:migrate.
RUN cd backend && npm run build

# Start - run migrations then start server
WORKDIR /app/backend
CMD ["sh", "-c", "npm run db:migrate && node dist/index.js"]
