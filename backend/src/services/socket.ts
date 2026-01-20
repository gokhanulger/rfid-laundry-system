import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  tenantId?: string | null;
  userRole?: string;
}

let io: Server | null = null;

// JWT verification for socket auth
function verifyToken(token: string): { userId: string; tenantId: string | null; role: string } | null {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET not configured');
      return null;
    }
    const decoded = jwt.verify(token, jwtSecret) as { id: string; tenantId: string | null; role: string };
    return { userId: decoded.id, tenantId: decoded.tenantId, role: decoded.role };
  } catch {
    return null;
  }
}

export function initializeSocket(server: HttpServer): Server {
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:3002',
    'http://localhost:5173',
  ].filter(Boolean) as string[];

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.some(allowed => origin.startsWith(allowed.replace(/\/$/, '')))) {
          return callback(null, true);
        }
        if (origin.includes('.vercel.app')) {
          return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    },
    path: '/socket.io',
  });

  // Authentication middleware
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      logger.warn('Socket connection rejected: No token provided');
      return next(new Error('Authentication required'));
    }

    const user = verifyToken(token);
    if (!user) {
      logger.warn('Socket connection rejected: Invalid token');
      return next(new Error('Invalid token'));
    }

    socket.userId = user.userId;
    socket.tenantId = user.tenantId;
    socket.userRole = user.role;
    next();
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`Socket connected: ${socket.id} (user: ${socket.userId}, tenant: ${socket.tenantId})`);

    // Join tenant room automatically
    if (socket.tenantId) {
      socket.join(`tenant:${socket.tenantId}`);
      logger.info(`Socket ${socket.id} joined room tenant:${socket.tenantId}`);
    }

    // Admin users can join all tenant rooms for dashboard
    if (socket.userRole === 'system_admin' || socket.userRole === 'laundry_manager') {
      socket.join('admin');
      logger.info(`Socket ${socket.id} joined admin room`);
    }

    // Handle explicit room join/leave (for admins monitoring specific hotels)
    socket.on('join:tenant', (tenantId: string) => {
      if (socket.userRole === 'system_admin' || socket.userRole === 'laundry_manager') {
        socket.join(`tenant:${tenantId}`);
        logger.info(`Socket ${socket.id} joined room tenant:${tenantId}`);
      }
    });

    socket.on('leave:tenant', (tenantId: string) => {
      socket.leave(`tenant:${tenantId}`);
      logger.info(`Socket ${socket.id} left room tenant:${tenantId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id} (reason: ${reason})`);
    });

    socket.on('error', (error) => {
      logger.error(`Socket error: ${socket.id}`, error);
    });
  });

  logger.info('Socket.io server initialized');
  return io;
}

export function getSocketServer(): Server | null {
  return io;
}

// Emit to a specific tenant room
export function emitToTenant(tenantId: string, event: string, data: any): void {
  if (!io) {
    logger.warn('Socket.io not initialized, cannot emit');
    return;
  }
  io.to(`tenant:${tenantId}`).emit(event, data);
}

// Emit to admin room (for dashboard updates)
export function emitToAdmins(event: string, data: any): void {
  if (!io) {
    logger.warn('Socket.io not initialized, cannot emit');
    return;
  }
  io.to('admin').emit(event, data);
}

// Emit to all connected clients
export function emitToAll(event: string, data: any): void {
  if (!io) {
    logger.warn('Socket.io not initialized, cannot emit');
    return;
  }
  io.emit(event, data);
}
