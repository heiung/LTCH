import { createHash } from 'node:crypto';
export function createD1RateLimiter(db, clock = Date.now) {
  const rules = { begin: {max: 10, window: 900000}, complete: {max: 30, window: 900000} };
  return async (request, action) => {
    const rule=rules[action], ip=request.headers.get('CF-Connecting-IP'), now=clock();
    if (!rule || !ip || ip.length > 80 || !Number.isSafeInteger(now)) return false;
    const bucket=Math.floor(now/rule.window);
    const key=createHash('sha256').update(JSON.stringify([action,ip,bucket])).digest('hex');
    const row=await db.prepare('INSERT INTO rate_limits (id, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(key,(bucket+2)*rule.window,rule.max).first();
    return Boolean(row);
  };
}
