import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators';
import { config } from './config';
import { MailService } from './mail/mail.service';
import { OcrService } from './photos/ocr.service';
import { version } from './version';

@Controller()
export class HealthController {
  constructor(
    private readonly ocr: OcrService,
    private readonly mail: MailService,
  ) {}

  /** Wird von App und Docker-Healthcheck genutzt; verrät nur, was die App zum Einrichten braucht. */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', name: 'MeterBook', version, ocr: this.ocr.enabled, env: config.envName || null, mail: this.mail.mode };
  }
}
