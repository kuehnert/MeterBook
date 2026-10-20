import { Card, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MeterForm, MeterFormValues, toPayload } from '../components/MeterForm';
import { post } from '../lib/api';
import type { Meter } from '../lib/types';

const base = { serialNumber: '', location: '', notes: '', ocrHint: '', billingStartMonth: 1, billingStartDay: 1 };

const PRESETS: Record<string, { label: string; values: MeterFormValues }> = {
  power: {
    label: 'Strom',
    values: {
      ...base,
      name: 'Nutzstrom',
      medium: 'ELECTRICITY',
      icon: null,
      unit: 'kWh',
      ocrHint: 'Digitaler Zähler: nur die Anzeige 1.8.0 verwenden.',
      registers: [{ name: 'Bezug', code: '1.8.0', decimals: 0 }],
    },
  },
  heat: {
    label: 'Heizstrom HT/NT',
    values: {
      ...base,
      name: 'Heizstrom',
      medium: 'ELECTRICITY',
      icon: 'HEATING',
      unit: 'kWh',
      billingStartMonth: 7,
      ocrHint: 'Zwei Rollenzählwerke: oben HT, unten NT. Die letzte, rot hinterlegte Stelle ist die Nachkommastelle.',
      registers: [
        { name: 'HT', code: 'HT', decimals: 1 },
        { name: 'NT', code: 'NT', decimals: 1 },
      ],
    },
  },
  water: {
    label: 'Wasser',
    values: {
      ...base,
      name: 'Wasser',
      medium: 'WATER',
      icon: null,
      unit: 'm³',
      ocrHint: 'Schwarze Ziffern sind ganze m³, rote Ziffern Nachkommastellen.',
      registers: [{ name: 'Wasser', code: '', decimals: 3 }],
    },
  },
  custom: {
    label: 'Eigener',
    values: { ...base, name: '', medium: 'OTHER', icon: null, unit: '', registers: [{ name: 'Stand', code: '', decimals: 1 }] },
  },
};

export function NewMeterPage() {
  const [preset, setPreset] = useState('power');
  const navigate = useNavigate();
  const qc = useQueryClient();

  return (
    <Stack maw={800}>
      <Title order={2}>Zähler hinzufügen</Title>
      <Card withBorder>
        <Stack>
          <div>
            <Text size="sm" fw={500} mb={6}>
              Vorlage
            </Text>
            <SegmentedControl
              value={preset}
              onChange={setPreset}
              data={Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label }))}
              fullWidth
            />
          </div>
          <MeterForm
            key={preset}
            initial={PRESETS[preset].values}
            submitLabel="Zähler anlegen"
            onSubmit={async (v) => {
              try {
                const m = await post<Meter>('/meters', toPayload(v));
                await qc.invalidateQueries();
                notifications.show({ color: 'green', message: `${m.name} angelegt` });
                navigate(`/meters/${m.id}`);
              } catch (e) {
                notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Fehler' });
              }
            }}
          />
        </Stack>
      </Card>
    </Stack>
  );
}
