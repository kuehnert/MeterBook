import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { User } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { reminderMail } from '../mail/templates';
import { PrismaService } from '../prisma.service';
import { nextStart, periodStart, ReminderInterval, readSince } from './schedule';

const CHECK_EVERY = 5 * 60_000;
/** Verpasste Erinnerungs-Mails (Server war aus) werden nur am selben Tag nachgeholt. */
const MAIL_GRACE = 24 * 3_600_000;

export interface ReminderState {
  interval: ReminderInterval;
  email: boolean;
  skipUntil: string | null;
  /** Aktueller Termin (Beginn), null = keine Erinnerung eingestellt */
  current: string | null;
  next: string | null;
  /** Der aktuelle Termin wird übersprungen */
  skipped: boolean;
  /** Zähler, die seit dem aktuellen Termin noch nicht abgelesen wurden */
  due: { id: string; name: string }[];
  /** Erinnerung ist offen: Termin da, nicht übersprungen, Zähler fällig */
  active: boolean;
}

@Injectable()
export class RemindersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(RemindersService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.MB_CLI) return;
    this.timer = setInterval(() => void this.sendDueMails(), CHECK_EVERY);
    setTimeout(() => void this.sendDueMails(), 30_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async state(userId: string, now = new Date()): Promise<ReminderState> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.stateOf(user, now);
  }

  private async stateOf(user: User, now: Date): Promise<ReminderState> {
    const interval = user.reminderInterval as ReminderInterval;
    const current = periodStart(interval, now);
    const skipped = !!current && !!user.reminderSkipUntil && user.reminderSkipUntil >= current;
    const due = current ? await this.dueMeters(user.id, current) : [];
    return {
      interval,
      email: user.reminderEmail,
      skipUntil: user.reminderSkipUntil?.toISOString() ?? null,
      current: current?.toISOString() ?? null,
      next: nextStart(interval, now)?.toISOString() ?? null,
      skipped,
      due,
      active: !!current && !skipped && due.length > 0,
    };
  }

  /** Zähler ohne Ablesung seit dem Termin (Ablesungen vom Vortag zählen mit). */
  async dueMeters(userId: string, start: Date) {
    const meters = await this.prisma.meter.findMany({
      where: { userId, archived: false, registers: { some: {} } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, registers: { select: { readings: { where: { readAt: { gte: readSince(start) } }, take: 1, select: { id: true } } } } },
    });
    return meters.filter((m) => !m.registers.some((r) => r.readings.length > 0)).map((m) => ({ id: m.id, name: m.name }));
  }

  async update(userId: string, patch: { interval?: ReminderInterval; email?: boolean }) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        reminderInterval: patch.interval,
        reminderEmail: patch.email,
        // Neuer Rhythmus: für den gerade laufenden Termin keine Mail mehr nachschicken
        ...(patch.interval ? { reminderMailedFor: periodStart(patch.interval, new Date()), reminderSkipUntil: null } : {}),
      },
    });
    return this.state(userId);
  }

  /** Überspringt den aktuellen (`current`) oder auch den nächsten Termin (`next`); `none` hebt das auf. */
  async skip(userId: string, which: 'current' | 'next' | 'none', now = new Date()) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const interval = user.reminderInterval as ReminderInterval;
    const until = which === 'none' ? null : which === 'next' ? nextStart(interval, now) : periodStart(interval, now);
    await this.prisma.user.update({ where: { id: userId }, data: { reminderSkipUntil: until } });
    return this.state(userId, now);
  }

  /** Eine Mail je Termin an alle, die per E-Mail erinnert werden wollen und noch etwas ablesen müssen. */
  async sendDueMails(now = new Date()): Promise<number> {
    let sent = 0;
    try {
      const users = await this.prisma.user.findMany({ where: { reminderInterval: { not: 'OFF' }, reminderEmail: true } });
      for (const user of users) {
        const interval = user.reminderInterval as ReminderInterval;
        const current = periodStart(interval, now);
        if (!current || now.getTime() - current.getTime() > MAIL_GRACE) continue;
        if (user.reminderMailedFor && user.reminderMailedFor >= current) continue;
        const st = await this.stateOf(user, now);
        // Erst vermerken, dann senden: lieber eine Mail verlieren als doppelt schicken
        await this.prisma.user.update({ where: { id: user.id }, data: { reminderMailedFor: current } });
        if (!st.active) continue;
        try {
          await this.mail.send(reminderMail(user.email, user.name, st.due.map((m) => m.name), interval as 'WEEKLY' | 'MONTHLY'));
          sent++;
        } catch (e) {
          this.log.error(`Erinnerung an ${user.email} fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      this.log.error(`Erinnerungen fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    }
    return sent;
  }
}
