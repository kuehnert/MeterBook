import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService, PENDING_PREFIX, toPublicUser } from '../auth/auth.service';
import { AdminOnly, AuthUser, CurrentUser } from '../auth/decorators';
import { hashPassword, newOpaqueToken } from '../auth/password';
import { PrismaService } from '../prisma.service';

class CreateUserDto {
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse eingeben' })
  email: string;
  @IsString()
  @MinLength(1, { message: 'Bitte einen Namen eingeben' })
  name: string;
  /** Leer lassen und `invite` setzen: die Person legt ihr Passwort selbst über die Einladung fest */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Das Passwort braucht mindestens 8 Zeichen' })
  password?: string;
  @IsOptional()
  @IsIn(['ADMIN', 'USER'])
  role?: 'ADMIN' | 'USER';
  @IsOptional()
  @IsBoolean()
  invite?: boolean;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Das Passwort braucht mindestens 8 Zeichen' })
  password?: string;
  @IsOptional()
  @IsIn(['ADMIN', 'USER'])
  role?: 'ADMIN' | 'USER';
}

@AdminOnly()
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list() {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(toPublicUser);
  }

  @Post()
  async create(@Body() dto: CreateUserDto, @CurrentUser() me: AuthUser) {
    const email = dto.email.trim().toLowerCase();
    if (!dto.password && !dto.invite) throw new BadRequestException('Bitte ein Passwort festlegen oder eine Einladung senden');
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException('Diese E-Mail-Adresse ist schon vergeben');
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        role: dto.role ?? 'USER',
        passwordHash: dto.password ? await hashPassword(dto.password) : PENDING_PREFIX + newOpaqueToken(),
      },
    });
    if (dto.invite) await this.auth.sendInvite(user.id, await this.nameOf(me.id));
    return toPublicUser(user);
  }

  /** Einladung (erneut) senden – auch als „Link zum Passwort festlegen“ für bestehende Konten. */
  @Post(':id/invite')
  @HttpCode(204)
  async invite(@Param('id') id: string, @CurrentUser() me: AuthUser) {
    await this.auth.sendInvite(id, await this.nameOf(me.id));
  }

  private async nameOf(id: string) {
    return (await this.prisma.user.findUniqueOrThrow({ where: { id } })).name;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() me: AuthUser) {
    if (id === me.id && dto.role === 'USER') {
      throw new BadRequestException('Du kannst dir nicht selbst die Administratorrechte entziehen');
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name,
        role: dto.role,
        passwordHash: dto.password ? await hashPassword(dto.password) : undefined,
      },
    });
    if (dto.password) await this.prisma.refreshToken.deleteMany({ where: { userId: id } });
    return toPublicUser(user);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() me: AuthUser) {
    if (id === me.id) throw new BadRequestException('Du kannst dein eigenes Konto nicht löschen');
    await this.prisma.user.delete({ where: { id } });
  }
}
