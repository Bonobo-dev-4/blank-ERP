import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  loginRequest, pinLoginRequest, refreshRequest,
  type AuthenticatedUser, type LoginResponse,
} from '@dnd/contracts';
import type { Request } from 'express';
import { Public } from '../../common/auth/guards';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiZodBody, ZodBody } from '../../common/zod/zod.decorators';
import { AuthService } from './auth.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiZodBody(loginRequest)
  login(
    @ZodBody(loginRequest) body: { email: string; password: string },
    @Req() req: Request,
  ): Promise<LoginResponse> {
    return this.auth.login(body.email, body.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Post('pin-login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Shop-floor sign in with employee code and PIN' })
  @ApiZodBody(pinLoginRequest)
  pinLogin(
    @ZodBody(pinLoginRequest) body: { employeeCode: string; pin: string; deviceId?: string },
    @Req() req: Request,
  ): Promise<LoginResponse> {
    return this.auth.pinLogin(body.employeeCode, body.pin, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      deviceId: body.deviceId,
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a refresh token for a new access token' })
  @ApiZodBody(refreshRequest)
  refresh(@ZodBody(refreshRequest) body: { refreshToken: string }): Promise<LoginResponse> {
    return this.auth.refresh(body.refreshToken);
  }

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user, their roles and their permissions' })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
