import { Injectable, Logger, OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { hashPassword, newOpaqueToken, sha256, verifyPassword } from './password';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

export const toPublicUser = (u: User): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role });

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Legt beim ersten Start den Administrator aus den Umgebungsvariablen an. */
  async onApplicationBootstrap() {
    if ((await this.prisma.user.count()) > 0) return;
    const { email, password, name } = config.admin;
    if (!email || !password) {
      this.log.warn('Noch kein Nutzer vorhanden – ADMIN_EMAIL und ADMIN_PASSWORD setzen.');
      return;
    }
    await this.prisma.user.create({
      data: { email: email.toLowerCase(), name, role: 'ADMIN', passwordHash: await hashPassword(password) },
    });
    this.log.log(`Administrator ${email} angelegt.`);
  }

  async login(email: string, password: string, device?: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('E-Mail oder Passwort falsch');
    }
    return this.issue(user, device);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.expiresAt < new Date()) {
      if (stored) await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new UnauthorizedException('Sitzung abgelaufen, bitte neu anmelden');
    }
    // Rotation: jeder Refresh-Token ist nur einmal gültig.
    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    return this.issue(stored.user, stored.device ?? undefined);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash: sha256(refreshToken) } });
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(current, user.passwordHash))) {
      throw new UnauthorizedException('Aktuelles Passwort falsch');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  private async issue(user: User, device?: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      { expiresIn: config.accessTokenTtlSeconds },
    );
    const refreshToken = newOpaqueToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        device: device?.slice(0, 200),
        expiresAt: new Date(Date.now() + config.refreshTokenTtlDays * 86_400_000),
      },
    });
    return { accessToken, refreshToken, expiresIn: config.accessTokenTtlSeconds, user: toPublicUser(user) };
  }
}
