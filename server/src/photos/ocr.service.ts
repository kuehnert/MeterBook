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
  id: string;
  name: string;
  medium: string;
  unit: string;
  serialNumber: string | null;
  ocrHint: string | null;
  registers: OcrRegisterInput[];
}

/** Ausschnitt im Bild, relativ zur Bildgröße (0–1): links, oben, Breite, Höhe */
export type Box = [number, number, number, number];

export interface OcrRegisterResult {
  registerId: string;
  value: number | null;
  confidence: number;
  digits: string;
  box: Box | null;
}

export interface OcrResult {
  model: string;
  /** Erkannter Zähler (bei bekanntem Zähler immer dieser) */
  meterId: string | null;
  meterConfidence: number;
  registers: OcrRegisterResult[];
  serialNumberSeen: string | null;
  serialNumberMatches: boolean | null;
  issues: string[];
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['meter_id', 'meter_confidence', 'registers', 'serial_number_seen', 'issues'],
  properties: {
    meter_id: {
      type: ['string', 'null'],
      description: 'meter_id des Zählers auf dem Foto, null wenn keiner der Kandidaten passt',
    },
    meter_confidence: { type: 'number', description: 'Sicherheit der Zuordnung, 0 bis 1' },
    registers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['register_id', 'digits', 'value', 'confidence', 'box'],
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
          box: {
            type: ['array', 'null'],
            items: { type: 'number' },
            description: 'Rechteck um die Ziffern dieses Zählwerks als [links, oben, Breite, Höhe], jeweils als Anteil (0 bis 1) der Bildbreite bzw. -höhe',
          },
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
- Bestimme zuerst, welcher der angegebenen Zähler auf dem Foto ist: Zählernummer, Bauart (digital/Rollenzählwerk), Anzahl und Beschriftung der Zählwerke, Einheit (kWh, m³). Gib dessen meter_id zurück und lies nur dessen Zählwerke ab. Passt keiner, ist meter_id null und registers leer.
- Lies jede Ziffer einzeln ab. Gib immer deinen besten Schätzwert an, auch wenn einzelne Ziffern schwer lesbar sind – der Nutzer korrigiert dann nur die markierten Stellen. Unsichere Ziffern kommen in "digits" in eckige Klammern und senken "confidence".
- Rollenzählwerke: Steht eine Rolle zwischen zwei Ziffern, gilt die kleinere Ziffer (außer beim Übergang 9→0: dann die 9).
- Nachkommastellen sind oft rot hinterlegt, kleiner oder durch ein Komma abgesetzt. Lies sie mit ab und setze das Komma davor – sie dürfen nie als Einerstelle gelesen werden. Ob sie gespeichert werden, entscheidet die Anwendung.
- Digitale Zähler (LCD) zeigen oft wechselnde Werte; verwende die Anzeige mit dem OBIS-Code, der zum Zählwerk passt (z. B. 1.8.0 für Bezug). Zeigt das Foto einen anderen Code, gib den Wert trotzdem an, setze confidence niedrig und nenne das in "issues".
- Zähler mit HT/NT haben zwei getrennte Zählwerke; ordne sie anhand der Beschriftung zu.
- "box" umschließt genau die Ziffernreihe des Zählwerks (inklusive Nachkommastellen), damit der Nutzer sie vergrößert prüfen kann.
- Der letzte bekannte Stand dient nur zur Plausibilität. Ein neuer Stand ist normalerweise gleich oder etwas größer. Weicht deine Lesung stark ab, lies noch einmal genau, aber übernimm nie einfach den alten Wert.
- Gib für jedes Zählwerk des erkannten Zählers genau einen Eintrag zurück.`;

function describe(m: OcrMeterInput): string {
  return [
    `meter_id "${m.id}": ${m.name} (${m.medium}), Einheit ${m.unit}`,
    m.serialNumber ? `  Zählernummer: ${m.serialNumber}` : null,
    m.ocrHint ? `  Hinweis des Nutzers: ${m.ocrHint}` : null,
    '  Zählwerke:',
    ...m.registers.map(
      (r) =>
        `  - register_id "${r.id}": ${r.name}${r.code ? ` (${r.code})` : ''}` +
        (r.lastValue !== null ? `, letzter bekannter Stand ${r.lastValue}` : ''),
    ),
  ]
    .filter(Boolean)
    .join('\n');
}

function clampBox(b: number[] | null | undefined): Box | null {
  if (!b || b.length !== 4 || b.some((x) => typeof x !== 'number' || Number.isNaN(x))) return null;
  const [x, y, w, h] = b.map((v) => Math.min(1, Math.max(0, v)));
  if (w <= 0.01 || h <= 0.005) return null;
  return [x, y, Math.min(w, 1 - x), Math.min(h, 1 - y)];
}

@Injectable()
export class OcrService {
  private readonly log = new Logger(OcrService.name);
  private readonly client = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

  get enabled() {
    return this.client !== null;
  }

  /**
   * Liest ein Foto. Mit einem Kandidaten wird nur dieser Zähler abgelesen; mit mehreren
   * bestimmt die Erkennung zusätzlich, welcher Zähler auf dem Foto ist.
   */
  async read(image: Buffer, candidates: OcrMeterInput[]): Promise<OcrResult> {
    if (!this.client) throw new Error('Keine automatische Erkennung konfiguriert (ANTHROPIC_API_KEY fehlt)');
    if (candidates.length === 0) throw new Error('Keine Zähler angelegt');

    const intro =
      candidates.length === 1
        ? 'Auf dem Foto sollte dieser Zähler sein (meter_id trotzdem angeben; null, falls es eindeutig ein anderer Zähler ist):'
        : 'Welcher dieser Zähler ist auf dem Foto?';
    const text = [intro, '', ...candidates.map(describe)].join('\n');

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
            { type: 'text', text },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') throw new Error('Die Erkennung hat das Bild abgelehnt');
    if (response.stop_reason === 'max_tokens') throw new Error('Die Erkennung wurde abgebrochen');
    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('Leere Antwort der Erkennung');
    const parsed = JSON.parse(block.text) as {
      meter_id: string | null;
      meter_confidence: number;
      registers: Array<{ register_id: string; digits: string; value: number | null; confidence: number; box: number[] | null }>;
      serial_number_seen: string | null;
      issues: string[];
    };

    const meter = candidates.find((m) => m.id === parsed.meter_id) ?? (candidates.length === 1 ? candidates[0] : null);
    const byId = new Map(parsed.registers.map((r) => [r.register_id, r]));
    const normalizeSerial = (s: string) => s.replace(/[^0-9a-z]/gi, '').toLowerCase();
    const seen = parsed.serial_number_seen;
    const result: OcrResult = {
      model: response.model,
      meterId: meter?.id ?? null,
      meterConfidence: Math.min(1, Math.max(0, parsed.meter_confidence ?? 0)),
      registers: (meter?.registers ?? []).map((r) => {
        const hit = byId.get(r.id);
        return {
          registerId: r.id,
          value: hit?.value === null || hit?.value === undefined ? null : truncate(hit.value, r.decimals),
          confidence: Math.min(1, Math.max(0, hit?.confidence ?? 0)),
          digits: hit?.digits ?? '',
          box: clampBox(hit?.box),
        };
      }),
      serialNumberSeen: seen,
      serialNumberMatches:
        seen && meter?.serialNumber
          ? normalizeSerial(seen).includes(normalizeSerial(meter.serialNumber)) ||
            normalizeSerial(meter.serialNumber).includes(normalizeSerial(seen))
          : null,
      issues: parsed.issues ?? [],
    };
    this.log.log(
      `Erkennung ${meter?.name ?? 'unbekannter Zähler'}: ${result.registers.map((r) => `${r.digits}(${r.confidence.toFixed(2)})`).join(', ')}`,
    );
    return result;
  }
}
