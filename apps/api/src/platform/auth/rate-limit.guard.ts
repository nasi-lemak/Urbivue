import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';

const WINDOW_MS = 60_000;
const CLEANUP_EVERY = 500;

/**
 * Fixed-window per-IP rate limit for unauthenticated public endpoints
 * (report intake, ratings). In-memory: sufficient for a single instance;
 * swap the store for Redis when running multiple API replicas.
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private calls = 0;

  canActivate(context: ExecutionContext): boolean {
    const limit = Number(process.env.PUBLIC_RATE_LIMIT_PER_MINUTE ?? 10);
    const req = context.switchToHttp().getRequest();
    const key = `${req.ip ?? 'unknown'}:${req.route?.path ?? req.path}`;
    const now = Date.now();

    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= limit) {
      throw new HttpException('Too many requests — please try again in a minute', 429);
    }
    recent.push(now);
    this.hits.set(key, recent);

    if (++this.calls % CLEANUP_EVERY === 0) {
      for (const [k, times] of this.hits) {
        if (times.every((t) => now - t >= WINDOW_MS)) this.hits.delete(k);
      }
    }
    return true;
  }
}
