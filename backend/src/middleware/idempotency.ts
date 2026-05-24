import { Request, Response, NextFunction } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db';

/**
 * Idempotency middleware (SYNC_V2 - Asama 2).
 *
 * If a request carries a clientOpId (body.clientOpId or X-Client-Op-Id header), the
 * operation is guaranteed to execute AT MOST ONCE, even if retried/replayed:
 *  - offline-queue replays (the storm class of bug),
 *  - double-fire (same action sent twice ~ms apart),
 *  - network retries.
 *
 * Requests WITHOUT a clientOpId are passed through untouched -> fully backward
 * compatible (web frontend, tablet, old builds keep working unchanged).
 *
 * Fail-open: if the idempotency store errors, the request proceeds normally rather
 * than being blocked. We never lose a legitimate operation because of bookkeeping.
 *
 * Backed by the `idempotency_keys` table (migration 0018). A clientOpId is claimed
 * atomically via INSERT .. ON CONFLICT DO NOTHING, so two concurrent identical
 * requests can't both execute.
 */

const MAX_STORED_BODY = 100_000; // don't store huge response bodies
const KEY_MAX_LEN = 200;

function getClientOpId(req: Request): string | null {
  const header = req.headers['x-client-op-id'];
  if (typeof header === 'string' && header.length > 0 && header.length <= KEY_MAX_LEN) {
    return header;
  }
  const body = (req.body && (req.body as any).clientOpId);
  if (typeof body === 'string' && body.length > 0 && body.length <= KEY_MAX_LEN) {
    return body;
  }
  return null;
}

// postgres-js drizzle .execute() returns an array-like of rows; normalize.
function rowCount(result: any): number {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result.count === 'number') return result.count;
  if (result && typeof result.rowCount === 'number') return result.rowCount;
  if (result && Array.isArray(result.rows)) return result.rows.length;
  return 0;
}
function firstRow(result: any): any {
  if (Array.isArray(result)) return result[0];
  if (result && Array.isArray(result.rows)) return result.rows[0];
  return undefined;
}

export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only mutating methods can have side effects worth deduping.
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    const clientOpId = getClientOpId(req);
    if (!clientOpId) return next();

    // 1) Atomically claim the key.
    let isNew = false;
    try {
      const claim = await db.execute(sql`
        INSERT INTO idempotency_keys (client_op_id, method, path)
        VALUES (${clientOpId}, ${req.method}, ${req.originalUrl})
        ON CONFLICT (client_op_id) DO NOTHING
        RETURNING client_op_id
      `);
      isNew = rowCount(claim) > 0;
    } catch (e) {
      console.error('[idempotency] claim failed, fail-open:', (e as Error).message);
      return next();
    }

    // 2) Already seen -> replay stored result, or report in-flight.
    if (!isNew) {
      try {
        const rows = await db.execute(sql`
          SELECT status_code, response_body FROM idempotency_keys WHERE client_op_id = ${clientOpId}
        `);
        const row = firstRow(rows);
        if (row && row.status_code != null) {
          console.log(`[idempotency] replay clientOpId=${clientOpId} -> ${row.status_code}`);
          res.status(Number(row.status_code));
          return res.json(row.response_body ? JSON.parse(row.response_body) : { idempotent: true });
        }
      } catch {
        // fall through to in-flight response
      }
      // Claimed but not finished yet (concurrent in-flight). Tell client it's accepted;
      // local state already reflects the action and the next sync reconciles.
      console.log(`[idempotency] in-flight duplicate clientOpId=${clientOpId}`);
      return res.status(200).json({ idempotent: true, inFlight: true, clientOpId });
    }

    // 3) New op: capture the response so future replays return the same thing.
    const originalJson = res.json.bind(res);
    let captured = false;
    (res as any).json = (body: any) => {
      captured = true;
      const code = res.statusCode;
      if (code >= 500) {
        // Transient server error -> release the claim so a retry can run.
        db.execute(sql`DELETE FROM idempotency_keys WHERE client_op_id = ${clientOpId}`).catch(() => {});
      } else {
        let stored: string | null = null;
        try {
          const s = JSON.stringify(body);
          if (s && s.length <= MAX_STORED_BODY) stored = s;
        } catch { /* unserializable -> store nothing */ }
        db.execute(sql`
          UPDATE idempotency_keys SET status_code = ${code}, response_body = ${stored}
          WHERE client_op_id = ${clientOpId}
        `).catch(() => {});
      }
      return originalJson(body);
    };
    // Safety: response finished without res.json (res.end / streamed / unexpected) ->
    // release the claim so the op isn't stuck "done" with no stored result.
    res.on('finish', () => {
      if (!captured) {
        db.execute(sql`DELETE FROM idempotency_keys WHERE client_op_id = ${clientOpId}`).catch(() => {});
      }
    });

    next();
  };
}

/**
 * Periodically delete old idempotency keys so the table doesn't grow unbounded.
 * Keys only need to outlive the longest plausible offline/replay window.
 */
export function startIdempotencyCleanup(maxAgeDays = 7, everyMs = 60 * 60 * 1000) {
  const run = () => {
    db.execute(sql`DELETE FROM idempotency_keys WHERE created_at < now() - (${maxAgeDays} || ' days')::interval`)
      .catch((e) => console.error('[idempotency] cleanup error:', (e as Error).message));
  };
  setInterval(run, everyMs);
}
