import { User } from '../middleware/auth';

declare global {
  namespace Express {
    interface Session {
      userId?: string;
    }
  }
}

export {};

