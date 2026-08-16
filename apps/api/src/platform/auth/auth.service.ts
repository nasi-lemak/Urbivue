import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import type { Role } from '@urbivue/shared';
import { DbService } from '../db/db.service';

export interface AuthUser {
  sub: string;
  email: string;
  displayName: string;
  role: Role;
}

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return secret ?? 'urbivue-dev-secret';
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService) {}

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const result = await this.db.query<{
      id: string;
      email: string;
      display_name: string;
      password_hash: string;
      role: Role;
    }>(
      'SELECT id, email, display_name, password_hash, role FROM users WHERE email = $1 AND active',
      [email],
    );
    const row = result.rows[0];
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const user: AuthUser = {
      sub: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    };
    const token = jwt.sign(user, jwtSecret(), { expiresIn: '12h' });
    return { token, user };
  }

  verify(token: string): AuthUser {
    try {
      return jwt.verify(token, jwtSecret()) as AuthUser;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
