import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_ADMIN, IS_PUBLIC } from './decorators';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Nicht angemeldet');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: 'ADMIN' | 'USER' }>(token);
      req.user = { id: payload.sub, role: payload.role };
    } catch {
      throw new UnauthorizedException('Sitzung abgelaufen');
    }
    if (this.reflector.getAllAndOverride<boolean>(IS_ADMIN, targets) && req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Nur für Administratoren');
    }
    return true;
  }
}
