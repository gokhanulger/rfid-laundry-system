import { db } from '../db';
import { users } from '../db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Otelin bildirim email adresini cozer.
 * Once tenant kaydindaki email'e bakar; bos ise o otelin aktif hotel_owner
 * kullanicisinin email'ine duser (cogu otelde email tenant'a degil kullanici
 * hesabina girilmis oluyor). Hicbiri yoksa undefined doner.
 */
export async function resolveHotelEmail(
  tenantId: string,
  tenantEmail?: string | null
): Promise<string | undefined> {
  const direct = tenantEmail?.trim();
  if (direct) return direct;

  const owner = await db.query.users.findFirst({
    where: and(
      eq(users.tenantId, tenantId),
      eq(users.role, 'hotel_owner'),
      eq(users.isActive, true)
    ),
    columns: { email: true },
  });

  return owner?.email?.trim() || undefined;
}
