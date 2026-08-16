import { Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuthService, type AuthUser } from './auth.service';
import { Public } from './decorators';
import { DbService } from '../db/db.service';
import { zodParse } from '../zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: DbService,
  ) {}

  @Public()
  @Post('login')
  login(@Body() body: unknown) {
    const { email, password } = zodParse(loginSchema, body);
    return this.auth.login(email, password);
  }

  @Get('me')
  me(@Req() req: { user: unknown }) {
    return req.user;
  }

  @Post('change-password')
  async changePassword(@Body() body: unknown, @Req() req: { user: AuthUser }) {
    const { currentPassword, newPassword } = zodParse(changePasswordSchema, body);
    const row = await this.db.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1 AND active',
      [req.user.sub],
    );
    if (!row.rows[0] || !bcrypt.compareSync(currentPassword, row.rows[0].password_hash)) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
      req.user.sub,
      bcrypt.hashSync(newPassword, 10),
    ]);
    return { changed: true };
  }
}
