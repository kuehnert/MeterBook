import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { toPublicUser } from '../auth/auth.service';
import { AdminOnly, AuthUser, CurrentUser } from '../auth/decorators';
import { hashPassword } from '../auth/password';
import { PrismaService } from '../prisma.service';

class CreateUserDto {
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse eingeben' })
  email: string;
  @IsString()
  @MinLength(1, { message: 'Bitte einen Namen eingeben' })
  name: string;
  @IsString()
  @MinLength(8, { message: 'Das Passwort braucht mindestens 8 Zeichen' })
  password: string;
  @IsOptional()
  @IsIn(['ADMIN', 'USER'])
  role?: 'ADMIN' | 'USER';
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
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(toPublicUser);
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException('Diese E-Mail-Adresse ist schon vergeben');
    }
    const user = await this.prisma.user.create({
      data: { email, name: dto.name, role: dto.role ?? 'USER', passwordHash: await hashPassword(dto.password) },
    });
    return toPublicUser(user);
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
