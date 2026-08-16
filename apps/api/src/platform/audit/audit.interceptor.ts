import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { DbService } from '../db/db.service';
import type { AuthUser } from '../auth/auth.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REDACTED_KEYS = new Set(['password', 'passwordHash', 'token']);

function sanitize(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key) ? '[redacted]' : value;
  }
  return out;
}

/** Records every successful mutating request in audit_log (fire-and-forget). */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!MUTATING.has(req.method) || req.path === '/api/auth/login') {
      return next.handle();
    }
    const user: AuthUser | undefined = req.user;
    return next.handle().pipe(
      tap(() => {
        const detail = (JSON.stringify(sanitize(req.body) ?? null) ?? 'null').slice(0, 4000);
        this.db
          .query(
            `INSERT INTO audit_log (actor_id, actor_email, action, entity_id, detail)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              user?.sub ?? null,
              user?.email ?? null,
              `${req.method} ${req.path}`,
              req.params?.id ?? null,
              detail,
            ],
          )
          .catch(() => undefined); // auditing must never break the request
      }),
    );
  }
}
