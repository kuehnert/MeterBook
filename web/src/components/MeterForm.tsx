import { ActionIcon, Button, Group, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { MEDIUM_LABEL, MONTHS } from '../lib/format';
import type { Medium, Meter, MeterIcon } from '../lib/types';
import { ICON_LABEL, MeterIconView } from './MediumIcon';

export interface MeterFormValues {
  name: string;
  medium: Medium;
  /** null = Symbol der Zählerart */
  icon: MeterIcon | null;
  unit: string;
  serialNumber: string;
  location: string;
  notes: string;
  ocrHint: string;
  billingStartMonth: number;
  billingStartDay: number;
  registers: Array<{ id?: string; name: string; code: string; decimals: number }>;
}

export function toFormValues(m: Meter): MeterFormValues {
  return {
    name: m.name,
    medium: m.medium,
    icon: m.icon,
    unit: m.unit,
    serialNumber: m.serialNumber ?? '',
    location: m.location ?? '',
    notes: m.notes ?? '',
    ocrHint: m.ocrHint ?? '',
    billingStartMonth: m.billingStartMonth,
    billingStartDay: m.billingStartDay,
    registers: m.registers.map((r) => ({ id: r.id, name: r.name, code: r.code ?? '', decimals: r.decimals })),
  };
}

export function toPayload(v: MeterFormValues) {
  return {
    ...v,
    serialNumber: v.serialNumber || undefined,
    location: v.location || undefined,
    notes: v.notes || undefined,
    ocrHint: v.ocrHint || undefined,
    registers: v.registers.map((r) => ({ id: r.id, name: r.name, code: r.code || undefined, decimals: r.decimals })),
  };
}

interface Props {
  initial: MeterFormValues;
  submitLabel: string;
  onSubmit: (v: MeterFormValues) => Promise<void>;
}

export function MeterForm({ initial, submitLabel, onSubmit }: Props) {
  const [v, setV] = useState<MeterFormValues>(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof MeterFormValues>(k: K, val: MeterFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const setReg = (i: number, patch: Partial<MeterFormValues['registers'][number]>) =>
    setV((s) => ({ ...s, registers: s.registers.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const move = (i: number, d: -1 | 1) =>
    setV((s) => {
      const regs = [...s.registers];
      [regs[i], regs[i + d]] = [regs[i + d], regs[i]];
      return { ...s, registers: regs };
    });

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(v);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Name" required value={v.name} onChange={(e) => set('name', e.currentTarget.value)} placeholder="z. B. Heizstrom" />
          <Group grow>
            <Select
              label="Art"
              data={Object.entries(MEDIUM_LABEL).map(([value, label]) => ({ value, label }))}
              value={v.medium}
              onChange={(x) => x && set('medium', x as Medium)}
              allowDeselect={false}
            />
            <TextInput label="Einheit" required value={v.unit} onChange={(e) => set('unit', e.currentTarget.value)} />
          </Group>
          <Select
            label="Symbol"
            description="Zur Unterscheidung in Übersicht und App"
            data={[
              { value: '', label: `Automatisch (${MEDIUM_LABEL[v.medium]})` },
              ...Object.entries(ICON_LABEL).map(([value, label]) => ({ value, label })),
            ]}
            value={v.icon ?? ''}
            onChange={(x) => set('icon', x ? (x as MeterIcon) : null)}
            allowDeselect={false}
            leftSection={<MeterIconView icon={v.icon ?? (v.medium as MeterIcon)} size={16} />}
          />
          <TextInput label="Zählernummer" value={v.serialNumber} onChange={(e) => set('serialNumber', e.currentTarget.value)} description="Wird beim Foto mit der Aufschrift verglichen" />
          <TextInput label="Ort" value={v.location} onChange={(e) => set('location', e.currentTarget.value)} placeholder="z. B. Keller, Bad" />
        </SimpleGrid>

        <div>
          <Text size="sm" fw={500}>
            Beginn der Abrechnungsperiode
          </Text>
          <Text size="xs" c="dimmed" mb={6}>
            Stichtag deines Versorgers. Berichte und Jahreswerte richten sich danach.
          </Text>
          <Group grow maw={360}>
            <NumberInput value={v.billingStartDay} onChange={(x) => set('billingStartDay', Number(x) || 1)} min={1} max={28} aria-label="Tag" suffix="." />
            <Select
              data={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              value={String(v.billingStartMonth)}
              onChange={(x) => x && set('billingStartMonth', Number(x))}
              allowDeselect={false}
              aria-label="Monat"
            />
          </Group>
        </div>

        <div>
          <Text size="sm" fw={500}>
            Zählwerke
          </Text>
          <Text size="xs" c="dimmed" mb={6}>
            Ein Zähler mit HT und NT hat zwei Zählwerke. „Nachkomma“ = wie viele Nachkommastellen gespeichert werden; 0 heißt nur ganze Einheiten. Es wird immer abgeschnitten, nicht gerundet – die Erkennung liest die roten Stellen trotzdem richtig mit. Verringern kürzt auch vorhandene Ablesungen.
          </Text>
          <Stack gap="xs">
            {v.registers.map((r, i) => (
              <Group key={r.id ?? `new-${i}`} gap="xs" wrap="nowrap" align="flex-end">
                <TextInput label={i === 0 ? 'Bezeichnung' : undefined} value={r.name} required onChange={(e) => setReg(i, { name: e.currentTarget.value })} style={{ flex: 2 }} />
                <TextInput label={i === 0 ? 'Kürzel' : undefined} value={r.code} onChange={(e) => setReg(i, { code: e.currentTarget.value })} placeholder="HT, 1.8.0" style={{ flex: 1 }} />
                <NumberInput label={i === 0 ? 'Nachkomma' : undefined} value={r.decimals} min={0} max={4} onChange={(x) => setReg(i, { decimals: Number(x) || 0 })} w={100} />
                <ActionIcon variant="subtle" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Nach oben" mb={4}>
                  <IconArrowUp size={16} />
                </ActionIcon>
                <ActionIcon variant="subtle" disabled={i === v.registers.length - 1} onClick={() => move(i, 1)} aria-label="Nach unten" mb={4}>
                  <IconArrowDown size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  disabled={v.registers.length === 1}
                  onClick={() => setV((s) => ({ ...s, registers: s.registers.filter((_, j) => j !== i) }))}
                  aria-label="Entfernen"
                  mb={4}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
          <Button
            variant="subtle"
            size="xs"
            mt="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => setV((s) => ({ ...s, registers: [...s.registers, { name: '', code: '', decimals: 1 }] }))}
          >
            Zählwerk hinzufügen
          </Button>
        </div>

        <Textarea
          label="Hinweis für die Erkennung"
          description="Hilft beim automatischen Ablesen, z. B. „Die roten Ziffern sind Nachkommastellen“"
          value={v.ocrHint}
          onChange={(e) => set('ocrHint', e.currentTarget.value)}
          autosize
          minRows={1}
        />
        <Textarea label="Notizen" value={v.notes} onChange={(e) => set('notes', e.currentTarget.value)} autosize minRows={1} />

        <Group justify="flex-end">
          <Button type="submit" loading={busy}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
