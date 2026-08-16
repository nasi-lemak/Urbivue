import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ROLES } from '@urbivue/shared';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.service';
import { zodParse } from '../zod';

const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  role: z.enum(ROLES),
  password: z.string().min(8).max(200),
});

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
});

const resetPasswordSchema = z.object({ password: z.string().min(8).max(200) });

@Injectable()
export class UsersService {
  constructor(private readonly db: DbService) {}

  list() {
    return this.db
      .query(
        `SELECT id, email, display_name AS "displayName", role, active,
                created_at AS "createdAt"
         FROM users ORDER BY created_at`,
      )
      .then((r) => r.rows);
  }

  async create(input: z.infer<typeof createUserSchema>) {
    try {
      const result = await this.db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash, role)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [input.email, input.displayName, bcrypt.hashSync(input.password, 10), input.role],
      );
      return { id: result.rows[0].id, email: input.email, role: input.role };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`User '${input.email}' already exists`);
      }
      throw err;
    }
  }

  /**
   * Lockout guards: you cannot demote or deactivate yourself, and the last
   * active admin can never be demoted or deactivated by anyone.
   */
  async update(id: string, input: z.infer<typeof updateUserSchema>, actor: AuthUser) {
    const current = await this.db.query<{ role: string; active: boolean }>(
      'SELECT role, active FROM users WHERE id = $1',
      [id],
    );
    if (!current.rows[0]) throw new NotFoundException(`User ${id} not found`);

    const losesAdmin =
      current.rows[0].role === 'admin' &&
      ((input.role && input.role !== 'admin') || input.active === false);
    if (losesAdmin) {
      if (id === actor.sub) {
        throw new BadRequestException('You cannot demote or deactivate your own account');
      }
      const others = await this.db.query(
        `SELECT 1 FROM users WHERE role = 'admin' AND active AND id <> $1 LIMIT 1`,
        [id],
      );
      if (!others.rowCount) {
        throw new BadRequestException('Cannot remove the last active admin');
      }
    }

    await this.db.query(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         role = COALESCE($3::user_role, role),
         active = COALESCE($4, active)
       WHERE id = $1`,
      [id, input.displayName ?? null, input.role ?? null, input.active ?? null],
    );
    return { id, updated: true };
  }

  async resetPassword(id: string, password: string) {
    const result = await this.db.query(
      'UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id',
      [id, bcrypt.hashSync(password, 10)],
    );
    if (!result.rowCount) throw new NotFoundException(`User ${id} not found`);
    return { id, passwordReset: true };
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermission('platform', 'manage')
  @Get()
  list() {
    return this.users.list();
  }

  @RequirePermission('platform', 'manage')
  @Post()
  create(@Body() body: unknown) {
    return this.users.create(zodParse(createUserSchema, body));
  }

  @RequirePermission('platform', 'manage')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: { user: AuthUser },
  ) {
    return this.users.update(id, zodParse(updateUserSchema, body), req.user);
  }

  @RequirePermission('platform', 'manage')
  @Post(':id/reset-password')
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.users.resetPassword(id, zodParse(resetPasswordSchema, body).password);
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
