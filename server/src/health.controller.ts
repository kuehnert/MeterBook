import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators';
import { OcrService } from './photos/ocr.service';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const { version } = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };

@Controller()
export class HealthController {
  constructor(private readonly ocr: OcrService) {}

  /** Wird von App und Docker-Healthcheck genutzt; verrät nur, was die App zum Einrichten braucht. */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', name: 'MeterBook', version, ocr: this.ocr.enabled };
  }
}
