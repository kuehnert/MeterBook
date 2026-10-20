import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { truncate } from '../common/util';
import { config } from '../config';

export interface OcrRegisterInput {
  id: string;
  name: string;
  code: string | null;
  decimals: number;
  /** Letzter bekannter Stand – hilft bei der Plausibilität schwer lesbarer Ziffern */
  lastValue: number | null;
}

export interface OcrMeterInput {
  name: string;
  medium: string;
  unit: string;
  serialNumber: string | null;
  ocrHint: string | null;
  registers: OcrRegisterInput[];
}

export interface OcrRegisterResult {
  registerId: string;
  value: number | null;
  confidence: number;
  digits: string;
}

export interface OcrResult {
  model: string;
  registers: OcrRegisterResult[];
  serialNumberSeen: string | null;
  serialNumberMatches: boolean | null;
  issues: string[];
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['registers', 'serial_number_seen', 'issues'],
  properties: {
    registers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['register_id', 'digits', 'value', 'confidence'],
        properties: {
          register_id: { type: 'string' },
          digits: {
            type: 'string',
            description: 'Alle angezeigten Ziffern inklusive Nachkommastellen, mit Komma davor. Unsichere Ziffern in eckigen Klammern mit deiner besten Schätzung, z. B. "029[7]89,6".',
          },
          value: {
            type: ['number', 'null'],
            description: 'Bester Schätzwert des vollständigen Zählerstands inkl. Nachkommastellen als Dezimalzahl. Nur null, wenn das Zählwerk gar nicht im Bild ist.',
          },
          confidence: { type: 'number', description: '0 bis 1' },
        },
      },
    },
    serial_number_seen: { type: ['string', 'null'] },
    issues: {
      type: 'array',
      items: { type: 'string' },
      description: 'Kurze Hinweise auf Deutsch, z. B. Spiegelung, Unschärfe, Ziffer zwischen zwei Werten',
    },
  },
} as const;

const SYSTEM = `Du liest Zählerstände von Fotos von Strom-, Wasser-, Gas- und Wärmezählern ab.

Regeln:
- Lies jede Ziffer einzeln ab. Gib immer deinen besten Schätzwert an, auch wenn einzelne Ziffern schwer lesbar sind – der Nutzer korrigiert dann nur die markierten Stellen. Unsichere Ziffern kommen in "digits" in eckige Klammern und senken "confidence".
- Rollenzählwerke: Steht eine Rolle zwischen zwei Ziffern, gilt die kleinere Ziffer (außer beim Übergang 9→0: dann die 9).
- Nachkommastellen sind oft rot hinterlegt, kleiner oder durch ein Komma abgesetzt. Lies sie mit ab und setze das Komma davor – sie dürfen nie als Einerstelle gelesen werden. Ob sie gespeichert werden, entscheidet die Anwendung.
- Digitale Zähler (LCD) zeigen oft wechselnde Werte; verwende die Anzeige mit dem OBIS-Code, der zum Zählwerk passt (z. B. 1.8.0 für Bezug). Zeigt das Foto einen anderen Code, gib den Wert trotzdem an, setze confidence niedrig und nenne das in "issues".
- Zähler mit HT/NT haben zwei getrennte Zählwerke; ordne sie anhand der Beschriftung zu.
- Der letzte bekannte Stand dient nur zur Plausibilität. Ein neuer Stand ist normalerweise gleich oder etwas größer. Weicht deine Lesung stark ab, lies noch einmal genau, aber übernimm nie einfach den alten Wert.
- Ist das Bild kein Zähler oder ein anderer Zähler (Seriennummer passt nicht), sage das in "issues".
- Gib für jedes angefragte Zählwerk genau einen Eintrag zurück.`;

@Injectable()
export class OcrService {
  private readonly log = new Logger(OcrService.name);
  private readonly client = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

  get enabled() {
    return this.client !== null;
  }

  async read(image: Buffer, meter: OcrMeterInput): Promise<OcrResult> {
    if (!this.client) throw new Error('Keine automatische Erkennung konfiguriert (ANTHROPIC_API_KEY fehlt)');

    const description = [
      `Zähler: ${meter.name} (${meter.medium}), Einheit ${meter.unit}`,
      meter.serialNumber ? `Erwartete Zählernummer: ${meter.serialNumber}` : null,
      meter.ocrHint ? `Hinweis des Nutzers: ${meter.ocrHint}` : null,
      'Zählwerke:',
      ...meter.registers.map(
        (r) =>
          `- register_id "${r.id}": ${r.name}${r.code ? ` (${r.code})` : ''}` +
          (r.lastValue !== null ? `, letzter bekannter Stand ${r.lastValue}` : ''),
      ),
    ]
      .filter(Boolean)
      .join('\n');

    const response = await this.client.beta.messages.create({
      model: config.ocrModel,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } },
            { type: 'text', text: description },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') throw new Error('Die Erkennung hat das Bild abgelehnt');
    if (response.stop_reason === 'max_tokens') throw new Error('Die Erkennung wurde abgebrochen');
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('Leere Antwort der Erkennung');
    const parsed = JSON.parse(text.text) as {
      registers: Array<{ register_id: string; digits: string; value: number | null; confidence: number }>;
      serial_number_seen: string | null;
      issues: string[];
    };

    const byId = new Map(parsed.registers.map((r) => [r.register_id, r]));
    const normalizeSerial = (s: string) => s.replace(/[^0-9a-z]/gi, '').toLowerCase();
    const seen = parsed.serial_number_seen;
    const result: OcrResult = {
      model: response.model,
      registers: meter.registers.map((r) => {
        const hit = byId.get(r.id);
        return {
          registerId: r.id,
          value: hit?.value === null || hit?.value === undefined ? null : truncate(hit.value, r.decimals),
          confidence: Math.min(1, Math.max(0, hit?.confidence ?? 0)),
          digits: hit?.digits ?? '',
        };
      }),
      serialNumberSeen: seen,
      serialNumberMatches:
        seen && meter.serialNumber
          ? normalizeSerial(seen).includes(normalizeSerial(meter.serialNumber)) ||
            normalizeSerial(meter.serialNumber).includes(normalizeSerial(seen))
          : null,
      issues: parsed.issues ?? [],
    };
    this.log.log(
      `Erkennung ${meter.name}: ${result.registers.map((r) => `${r.digits}(${r.confidence.toFixed(2)})`).join(', ')}`,
    );
    return result;
  }
}
