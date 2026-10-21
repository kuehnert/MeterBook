import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators';
import { config } from './config';
import { OcrService } from './photos/ocr.service';
import { version } from './version';

@Controller()
export class HealthController {
  constructor(private readonly ocr: OcrService) {}

  /** Wird von App und Docker-Healthcheck genutzt; verrät nur, was die App zum Einrichten braucht. */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', name: 'MeterBook', version, ocr: this.ocr.enabled, env: config.envName || null };
  }
}
