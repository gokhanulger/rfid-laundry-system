import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db';
import { users, tenants } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, AuthRequest, requireRole } from '../middleware/auth';
import { z } from 'zod';

export const usersRouter = Router();
usersRouter.use(requireAuth);
usersRouter.use(requireRole('system_admin', 'laundry_manager'));

const createUserSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  role: z.enum(['hotel_owner', 'laundry_manager', 'operator', 'driver', 'packager', 'system_admin']),
  tenantId: z.string().uuid().optional(),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.enum(['hotel_owner', 'laundry_manager', 'operator', 'driver', 'packager', 'system_admin']).optional(),
  tenantId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// Get all users
usersRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const allUsers = await db.query.users.findMany({
      orderBy: (users, { asc }) => [asc(users.firstName)],
      with: {
        tenant: true,
      },
    });

    // Remove password hash from response
    const sanitizedUsers = allUsers.map(({ passwordHash, ...user }) => user);
    res.json(sanitizedUsers);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user by ID
usersRouter.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
      with: {
        tenant: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { passwordHash, ...sanitizedUser } = user;
    res.json(sanitizedUser);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create user
usersRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const validation = createUserSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { email, password, firstName, lastName, role, tenantId } = validation.data;

    // Check if email already exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Verify tenant if provided
    if (tenantId) {
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
      });
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    const [newUser] = await db.insert(users).values({
      email,
      passwordHash,
      firstName,
      lastName,
      role,
      tenantId: tenantId || null,
    }).returning();

    const { passwordHash: _, ...sanitizedUser } = newUser;
    res.status(201).json(sanitizedUser);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user
usersRouter.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validation = updateUserSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const existingUser = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check email uniqueness if updating email
    if (validation.data.email && validation.data.email !== existingUser.email) {
      const emailExists = await db.query.users.findFirst({
        where: eq(users.email, validation.data.email),
      });
      if (emailExists) {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }

    const [updatedUser] = await db.update(users)
      .set({
        ...validation.data,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    const { passwordHash, ...sanitizedUser } = updatedUser;
    res.json(sanitizedUser);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset password
usersRouter.post('/:id/reset-password', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validation = resetPasswordSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const existingUser = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const passwordHash = await bcrypt.hash(validation.data.password, 10);

    await db.update(users)
      .set({
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user
usersRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user!;

    // Prevent self-deletion
    if (id === currentUser.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const existingUser = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    await db.delete(users).where(eq(users.id, id));

    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
