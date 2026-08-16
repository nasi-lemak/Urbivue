import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Parse a request body against a Zod schema, mapping failures to HTTP 400. */
export function zodParse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    });
  }
  return result.data;
}
