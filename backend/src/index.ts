import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import dotenv from 'dotenv';
import logger from './utils/logger';
import { authRouter } from './routes/auth';
import { itemsRouter } from './routes/items';
import { pickupsRouter } from './routes/pickups';
import { deliveriesRouter } from './routes/deliveries';
import { dashboardRouter } from './routes/dashboard';
import { alertsRouter } from './routes/alerts';
import { reportsRouter } from './routes/reports';
import { settingsRouter } from './routes/settings';
import { tenantsRouter } from './routes/tenants';
import { itemTypesRouter } from './routes/itemTypes';
import { usersRouter } from './routes/users';
import { reconciliationRouter } from './routes/reconciliation';
import { devicesRouter } from './routes/devices';
import { scanRouter } from './routes/scan';
import etaRouter from './routes/eta';
import { waybillsRouter } from './routes/waybills';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Rate limiting store (simple in-memory implementation)
// Key format: "ip:endpoint" for per-endpoint limiting
const rateLimitStore = new Map<string, { count: number; resetTime: number; blocked: boolean }>();

// Extract real client IP from X-Forwarded-For header (for proxied environments)
function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // X-Forwarded-For can be a comma-separated list, first one is the client
    const ips = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor).split(',');
    return ips[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function rateLimit(maxRequests: number, windowMs: number, keyPrefix: string = 'global') {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const key = `${ip}:${keyPrefix}`;
    const now = Date.now();
    const record = rateLimitStore.get(key);

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);

    if (!record || now > record.resetTime) {
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs, blocked: false });
      res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));
      return next();
    }

    const remaining = Math.max(0, maxRequests - record.count);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count >= maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);

      // Log rate limit violations for monitoring
      if (!record.blocked) {
        console.warn(`Rate limit exceeded for ${ip} on ${keyPrefix}`);
        record.blocked = true;
      }

      return res.status(429).json({
        error: 'Too many requests',
        retryAfter
      });
    }

    record.count++;
    next();
  };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(ip);
    }
  }
}, 60000); // Clean up every minute

// Security headers middleware
function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

// Request logging middleware
function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.request(req.method, req.path, res.statusCode, duration, {
      ip: getClientIp(req),
    });
  });
  next();
}

// Error handling middleware
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Unhandled error', err, {
    method: req.method,
    path: req.path,
    ip: getClientIp(req),
  });
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
}

// Apply security headers
app.use(securityHeaders);

// Request logging
app.use(requestLogger);

// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3002',
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(allowed => origin.startsWith(allowed.replace(/\/$/, '')))) {
      return callback(null, true);
    }
    // In production, also allow Vercel preview URLs
    if (origin.includes('.vercel.app')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
const sessionSecret = process.env.SESSION_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

if (!sessionSecret) {
  if (isProduction) {
    console.error('FATAL: SESSION_SECRET environment variable is required in production!');
    process.exit(1);
  }
  console.warn('WARNING: SESSION_SECRET not set. Using insecure default for development only.');
} else if (sessionSecret === 'change-me-in-production' || sessionSecret.length < 32) {
  if (isProduction) {
    console.error('FATAL: SESSION_SECRET is too weak for production! Use at least 32 random characters.');
    process.exit(1);
  }
  console.warn('WARNING: SESSION_SECRET is too weak. Use at least 32 random characters in production.');
}

app.set('trust proxy', 1); // Trust first proxy (Railway/Vercel)

app.use(session({
  secret: sessionSecret || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'rfid.sid',
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-domain
    partitioned: process.env.NODE_ENV === 'production', // CHIPS - Cookies Having Independent Partitioned State
  } as any, // TypeScript doesn't know about partitioned yet
}));

// Apply stricter rate limiting to auth endpoints (brute force protection)
app.use('/api/auth/login', rateLimit(10, 60000, 'login')); // 10 login attempts per minute
app.use('/api/auth/register', rateLimit(5, 60000, 'register')); // 5 registrations per minute

// Password reset endpoints need extra protection
app.use('/api/users/:id/reset-password', rateLimit(3, 60000, 'password-reset')); // 3 resets per minute

// Apply general rate limiting to all API endpoints
app.use('/api', rateLimit(200, 60000, 'api')); // 200 requests per minute

// Routes
app.use('/api/auth', authRouter);
app.use('/api/items', itemsRouter);
app.use('/api/pickups', pickupsRouter);
app.use('/api/deliveries', deliveriesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/item-types', itemTypesRouter);
app.use('/api/users', usersRouter);
app.use('/api/reconciliation', reconciliationRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/scan', scanRouter);
app.use('/api/eta', etaRouter);
app.use('/api/waybills', waybillsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// 404 handler
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler (must be last)
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
