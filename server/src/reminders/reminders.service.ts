import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { User } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { reminderMail } from '../mail/templates';
import { PrismaService } from '../prisma.service';
import { nextStart, periodStart, ReminderInterval, readSince } from './schedule';

const CHECK_EVERY = 5 * 60_000;
/** Verpasste Erinnerungs-Mails (Server war aus) werden nur am selben Tag nachgeholt. */
const MAIL_GRACE = 24 * 3_600_000;

export interface MeterReminder {
  id: string;
  name: string;
  /** Eigener Rhythmus des Zählers; null = Standard */
  interval: ReminderInterval | null;
  /** Tatsächlich geltender Rhythmus */
  effective: ReminderInterval;
  /** Aktueller Termin dieses Zählers */
  current: string | null;
  next: string | null;
}

export interface ReminderState {
  /** Standard-Rhythmus für alle Zähler ohne eigenen */
  interval: ReminderInterval;
  email: boolean;
  skipUntil: string | null;
  /** Jüngster Termin über alle Zähler, null = keine Erinnerung eingestellt */
  current: string | null;
  /** Nächster Termin über alle Zähler */
  next: string | null;
  /** Der aktuelle Termin wird übersprungen */
  skipped: boolean;
  /** Zähler, die seit ihrem aktuellen Termin noch nicht abgelesen wurden */
  due: { id: string; name: string }[];
  /** Erinnerung ist offen: Termin da, nicht übersprungen, Zähler fällig */
  active: boolean;
  /** Mindestens ein Zähler wird erinnert */
  enabled: boolean;
  meters: MeterReminder[];
}

const latest = (ds: (Date | null)[]) => ds.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);
const earliest = (ds: (Date | null)[]) => ds.reduce<Date | null>((a, d) => (d && (!a || d < a) ? d : a), null);

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
    const fallback = user.reminderInterval as ReminderInterval;
    const meters = await this.prisma.meter.findMany({
      where: { userId: user.id, archived: false, registers: { some: {} } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, reminderInterval: true, billingStartMonth: true, billingStartDay: true },
    });
    const perMeter = meters.map((m) => {
      const own = (m.reminderInterval as ReminderInterval | null) ?? null;
      const effective = own ?? fallback;
      const year = { month: m.billingStartMonth, day: m.billingStartDay };
      return { m, own, effective, start: periodStart(effective, now, year), next: nextStart(effective, now, year) };
    });
    const current = latest(perMeter.map((x) => x.start));
    const skipUntil = user.reminderSkipUntil;
    const skipped = !!current && !!skipUntil && skipUntil >= current;

    // Fällig: eigener Termin hat begonnen, seitdem (oder am Vortag) nicht abgelesen, nicht übersprungen
    const due: { id: string; name: string }[] = [];
    for (const x of perMeter) {
      if (!x.start || (skipUntil && skipUntil >= x.start)) continue;
      const read = await this.prisma.reading.findFirst({
        where: { register: { meterId: x.m.id }, readAt: { gte: readSince(x.start) } },
        select: { id: true },
      });
      if (!read) due.push({ id: x.m.id, name: x.m.name });
    }

    return {
      interval: fallback,
      email: user.reminderEmail,
      skipUntil: skipUntil?.toISOString() ?? null,
      current: current?.toISOString() ?? null,
      next: earliest(perMeter.map((x) => x.next))?.toISOString() ?? null,
      skipped,
      due,
      active: due.length > 0,
      enabled: perMeter.some((x) => x.effective !== 'OFF'),
      meters: perMeter.map((x) => ({
        id: x.m.id,
        name: x.m.name,
        interval: x.own,
        effective: x.effective,
        current: x.start?.toISOString() ?? null,
        next: x.next?.toISOString() ?? null,
      })),
    };
  }

  async update(userId: string, patch: { interval?: ReminderInterval; email?: boolean }) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        reminderInterval: patch.interval,
        reminderEmail: patch.email,
        // Neuer Rhythmus: für bereits laufende Termine keine Mail mehr nachschicken
        ...(patch.interval ? { reminderMailedFor: new Date(), reminderSkipUntil: null } : {}),
      },
    });
    return this.state(userId);
  }

  /** Eigener Rhythmus für einen Zähler; null = wieder der Standard. */
  async setMeterInterval(userId: string, meterId: string, interval: ReminderInterval | null) {
    const meter = await this.prisma.meter.findFirst({ where: { id: meterId, userId } });
    if (!meter) throw new NotFoundException('Zähler nicht gefunden');
    await this.prisma.meter.update({ where: { id: meterId }, data: { reminderInterval: interval } });
    await this.prisma.user.update({ where: { id: userId }, data: { reminderMailedFor: new Date() } });
    return this.state(userId);
  }

  /** Überspringt den aktuellen (`current`) oder auch den nächsten Termin (`next`); `none` hebt das auf. */
  async skip(userId: string, which: 'current' | 'next' | 'none', now = new Date()) {
    const st = await this.state(userId, now);
    const until = which === 'none' ? null : which === 'next' ? st.next : st.current;
    await this.prisma.user.update({ where: { id: userId }, data: { reminderSkipUntil: until ? new Date(until) : null } });
    return this.state(userId, now);
  }

  /** Eine Mail je Termin an alle, die per E-Mail erinnert werden wollen und noch etwas ablesen müssen. */
  async sendDueMails(now = new Date()): Promise<number> {
    let sent = 0;
    try {
      const users = await this.prisma.user.findMany({ where: { reminderEmail: true } });
      for (const user of users) {
        const st = await this.stateOf(user, now);
        if (!st.current) continue;
        const current = new Date(st.current);
        if (now.getTime() - current.getTime() > MAIL_GRACE) continue;
        if (user.reminderMailedFor && user.reminderMailedFor >= current) continue;
        // Erst vermerken, dann senden: lieber eine Mail verlieren als doppelt schicken
        await this.prisma.user.update({ where: { id: user.id }, data: { reminderMailedFor: current } });
        if (!st.active) continue;
        try {
          await this.mail.send(reminderMail(user.email, user.name, st.due.map((m) => m.name)));
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
