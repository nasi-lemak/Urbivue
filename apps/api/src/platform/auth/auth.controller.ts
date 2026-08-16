import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { Public } from './decorators';
import { zodParse } from '../zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
}
