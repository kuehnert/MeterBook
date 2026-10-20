import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma.service';
import { AuthService, toPublicUser } from './auth.service';
import { AuthUser, CurrentUser, Public } from './decorators';

class LoginDto {
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse eingeben' })
  email: string;
  @IsString()
  password: string;
}

class RefreshDto {
  @IsString()
  refreshToken: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword: string;
  @IsString()
  @MinLength(8, { message: 'Das neue Passwort braucht mindestens 8 Zeichen' })
  newPassword: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Headers('user-agent') ua?: string) {
    return this.auth.login(dto.email, dto.password, ua);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return toPublicUser(await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }));
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
