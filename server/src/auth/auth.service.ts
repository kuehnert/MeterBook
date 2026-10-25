import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { config } from '../config';
import { MailService } from '../mail/mail.service';
import { inviteMail, resetMail } from '../mail/templates';
import { PrismaService } from '../prisma.service';
import { hashPassword, newOpaqueToken, sha256, verifyPassword } from './password';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Eingeladen, aber noch kein Passwort festgelegt */
  pending: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

/** Kennzeichen eingeladener Konten ohne Passwort – passt nie zu verifyPassword */
export const PENDING_PREFIX = 'pending:';

export const toPublicUser = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  pending: u.passwordHash.startsWith(PENDING_PREFIX),
});

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
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

  /** Einladung: Link zum Festlegen des Passworts (7 Tage gültig) per E-Mail. */
  async sendInvite(userId: string, invitedBy: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const token = await this.linkToken(user.id, 'INVITE', 7 * 24);
    try {
      await this.mail.send(inviteMail(user.email, user.name, invitedBy, token));
    } catch (e) {
      this.log.error(`Einladung an ${user.email} fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException('Die Einladung konnte nicht verschickt werden – bitte später erneut senden');
    }
  }

  /** „Passwort vergessen“: verrät nie, ob es die Adresse gibt; höchstens eine Mail alle 2 Minuten. */
  async requestReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) return;
    const recent = await this.prisma.authToken.count({
      where: { userId: user.id, purpose: 'RESET', createdAt: { gt: new Date(Date.now() - 2 * 60_000) } },
    });
    if (recent > 0) return;
    const token = await this.linkToken(user.id, 'RESET', 1);
    try {
      await this.mail.send(resetMail(user.email, user.name, token));
    } catch (e) {
      this.log.error(`Mail zum Zurücksetzen an ${user.email} fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException('Die E-Mail konnte gerade nicht verschickt werden – bitte später noch einmal versuchen');
    }
  }

  /** Für die Seite „Passwort festlegen“: wofür ist der Link, für wen? */
  async linkInfo(token: string) {
    const stored = await this.validLink(token);
    return { purpose: stored.purpose, email: stored.user.email, name: stored.user.name };
  }

  /** Setzt das Passwort über einen Link aus der Mail und meldet direkt an. */
  async setPasswordWithLink(token: string, password: string, device?: string): Promise<TokenPair> {
    const stored = await this.validLink(token);
    const user = await this.prisma.user.update({
      where: { id: stored.userId },
      data: { passwordHash: await hashPassword(password) },
    });
    // Alle Links und Sitzungen dieses Kontos sind damit erledigt
    await this.prisma.authToken.deleteMany({ where: { userId: user.id } });
    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    return this.issue(user, device);
  }

  private async validLink(token: string) {
    const stored = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!stored || stored.expiresAt < new Date()) {
      throw new BadRequestException('Der Link ist abgelaufen oder wurde schon benutzt – bitte einen neuen anfordern');
    }
    return stored;
  }

  private async linkToken(userId: string, purpose: 'INVITE' | 'RESET', hours: number) {
    await this.prisma.authToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const token = newOpaqueToken();
    await this.prisma.authToken.create({
      data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3_600_000) },
    });
    return token;
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
