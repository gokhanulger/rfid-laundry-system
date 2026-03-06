FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/

# Install dependencies
RUN npm ci --workspace=backend --include-workspace-root

# Copy backend source
COPY backend/ ./backend/

# Build
RUN npm run build --workspace=backend

# Start
CMD ["npm", "run", "start", "--workspace=backend"]
