import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const authRouter = Router();

// Register
authRouter.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, role, tenantId } = req.body;

    // Check if user exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const [newUser] = await db.insert(users).values({
      email,
      passwordHash,
      firstName,
      lastName,
      role,
      tenantId: tenantId || null,
    }).returning();

    res.status(201).json({
      id: newUser.id,
      email: newUser.email,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      role: newUser.role,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    let user;
    try {
      user = await db.query.users.findFirst({
        where: eq(users.email, email),
        with: {
          tenant: true,
        },
      });
    } catch (dbError: any) {
      console.error('Database error during login:', dbError);
      return res.status(500).json({
        error: 'Database connection failed. Please check your database configuration.',
        details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
      });
    }

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Set session
    (req.session as any).userId = user.id;

    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: user.tenant?.name || null,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Logout
authRouter.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// Get current user
authRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  // Fetch user with tenant info
  const user = await db.query.users.findFirst({
    where: eq(users.id, req.user!.id),
    with: {
      tenant: true,
    },
  });

  res.json({
    id: req.user!.id,
    email: req.user!.email,
    firstName: req.user!.firstName,
    lastName: req.user!.lastName,
    role: req.user!.role,
    tenantId: req.user!.tenantId,
    tenantName: user?.tenant?.name || null,
  });
});

