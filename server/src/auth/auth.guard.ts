import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { IS_ADMIN, IS_PUBLIC } from './decorators';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Nicht angemeldet');
    let sub: string;
    try {
      sub = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw new UnauthorizedException('Sitzung abgelaufen');
    }
    // Nutzer und Rolle aus der Datenbank: gelöschte Konten (oder eine eingespielte Sicherung)
    // sperren sofort, geänderte Rollen gelten sofort.
    const user = await this.prisma.user.findUnique({ where: { id: sub }, select: { id: true, role: true } });
    if (!user) throw new UnauthorizedException('Sitzung abgelaufen');
    req.user = { id: user.id, role: user.role as 'ADMIN' | 'USER' };
    if (this.reflector.getAllAndOverride<boolean>(IS_ADMIN, targets) && req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Nur für Administratoren');
    }
    return true;
  }
}
