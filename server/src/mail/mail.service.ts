import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Versand per SMTP (z. B. SMTP2Go). Ohne SMTP_HOST werden die Mails nicht verschickt, sondern als
 * .eml-Datei in DATA_DIR/mail-outbox abgelegt – zum Testen in der Entwicklung.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private readonly transport: Transporter;
  readonly mode: 'smtp' | 'outbox' = config.mail.host ? 'smtp' : 'outbox';
  readonly outboxDir = path.join(config.dataDir, 'mail-outbox');

  constructor() {
    this.transport = config.mail.host
      ? nodemailer.createTransport({
          host: config.mail.host,
          port: config.mail.port,
          secure: config.mail.port === 465,
          auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
        })
      : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  }

  async send(mail: Mail): Promise<void> {
    const info = await this.transport.sendMail({ from: config.mail.from, ...mail });
    if (this.mode === 'outbox') {
      await mkdir(this.outboxDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(this.outboxDir, `${stamp}-${mail.to.replace(/[^\w.@-]/g, '_')}.eml`);
      await writeFile(file, (info as unknown as { message: Buffer }).message);
      this.log.log(`E-Mail „${mail.subject}“ an ${mail.to} abgelegt: ${file}`);
    } else {
      this.log.log(`E-Mail „${mail.subject}“ an ${mail.to} verschickt`);
    }
  }
}
