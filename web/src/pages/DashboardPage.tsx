import { ActionIcon, Affix, Alert, Badge, Button, Card, Center, Divider, Group, Loader, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconCamera, IconInbox, IconPlus } from '@tabler/icons-react';
import { useInbox } from './InboxPage';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ICON_COLOR, MediumIcon, iconOf } from '../components/MediumIcon';
import { ReadingModal } from '../components/ReadingModal';
import { get } from '../lib/api';
import { daysAgo, eur, lastDay, num } from '../lib/format';
import type { Meter, Overview } from '../lib/types';

export function DashboardPage() {
  const q = useQuery({ queryKey: ['overview'], queryFn: () => get<Overview[]>('/stats/overview') });
  const [capture, setCapture] = useState<Meter | null>(null);
  const inboxCount = useInbox().data?.length ?? 0;

  if (q.isLoading) return <Center h={200}><Loader /></Center>;
  const items = q.data ?? [];

  const totalForecast = items.reduce((s, o) => s + (o.currentPeriod?.forecastCost ?? 0), 0);
  const hasCosts = items.some((o) => o.currentPeriod?.forecastCost !== null && o.currentPeriod?.forecastCost !== undefined);

  return (
    <Stack>
      {inboxCount > 0 && (
        <Alert color="blue" variant="light" icon={<IconInbox size={18} />}>
          <Group justify="space-between">
            <Text size="sm">
              {inboxCount === 1 ? '1 Foto wartet' : `${inboxCount} Fotos warten`} im Eingang auf Prüfung.
            </Text>
            <Button size="xs" component={Link} to="/eingang">
              Zum Eingang
            </Button>
          </Group>
        </Alert>
      )}
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Übersicht</Title>
          {hasCosts && (
            <Text c="dimmed" size="sm">
              Voraussichtliche Kosten der laufenden Perioden: <b>{eur(totalForecast)}</b>
            </Text>
          )}
        </div>
      </Group>

      {items.length === 0 && (
        <Card withBorder p="xl">
          <Stack align="center">
            <Text>Noch keine Zähler angelegt.</Text>
            <Button component={Link} to="/meters/new" leftSection={<IconPlus size={16} />}>
              Ersten Zähler hinzufügen
            </Button>
          </Stack>
        </Card>
      )}

      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
        {items.map((o) => (
          <MeterCard key={o.meter.id} o={o} onCapture={() => setCapture(o.meter)} />
        ))}
      </SimpleGrid>

      {capture && <ReadingModal meter={capture} opened onClose={() => setCapture(null)} />}

      {/* Auf dem Handy: ein großer Knopf zum Fotografieren, der Zähler wird automatisch erkannt */}
      {items.length > 0 && (
        <Affix position={{ bottom: 24, right: 20 }} hiddenFrom="sm">
          <ActionIcon component={Link} to="/ablesen" size={64} radius="xl" variant="filled" aria-label="Zähler fotografieren" style={{ boxShadow: 'var(--mantine-shadow-md)' }}>
            <IconCamera size={30} />
          </ActionIcon>
        </Affix>
      )}
    </Stack>
  );
}

function MeterCard({ o, onCapture }: { o: Overview; onCapture: () => void }) {
  const m = o.meter;
  const p = o.currentPeriod;
  const stale = o.daysSinceLastReading === null || o.daysSinceLastReading > 35;
  const sum = (r: Record<string, number | null>) => {
    const vals = Object.values(r).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const day30 = sum(o.perDayLast30);
  const dayYear = sum(o.perDayLastYear);

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" color={ICON_COLOR[iconOf(m)]} size="lg">
            <MediumIcon meter={m} />
          </ThemeIcon>
          <div>
            <Text fw={600} component={Link} to={`/meters/${m.id}`}>
              {m.name}
            </Text>
            <Text size="xs" c="dimmed">
              {m.serialNumber ? `Nr. ${m.serialNumber}` : m.location ?? ''}
            </Text>
          </div>
        </Group>
        <Badge variant="light" color={stale ? 'orange' : 'gray'}>
          {daysAgo(o.daysSinceLastReading)}
        </Badge>
      </Group>

      <Group gap="xl" mb="sm">
        {m.registers.map((r) => (
          <div key={r.id}>
            <Text size="xs" c="dimmed">
              {m.registers.length > 1 ? r.name : 'Stand'}
            </Text>
            <Text fw={600} size="lg" className="tabular">
              {r.lastReading ? num(r.lastReading.value, r.decimals) : '–'} <Text span size="sm" c="dimmed">{m.unit}</Text>
            </Text>
          </div>
        ))}
      </Group>

      <Divider mb="sm" />

      {p ? (
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Laufende Periode {p.label} (bis {lastDay(p.end)})
          </Text>
          <Group justify="space-between">
            <Text size="sm">Bisher</Text>
            <Text size="sm" className="tabular">
              {num(p.total, 0)} {m.unit}
              {p.cost ? ` · ${eur(p.cost.total)}` : ''}
            </Text>
          </Group>
          {p.forecastTotal !== null && (
            <Group justify="space-between">
              <Text size="sm">Hochrechnung</Text>
              <Text size="sm" fw={600} className="tabular">
                {num(p.forecastTotal, 0)} {m.unit}
                {p.forecastCost !== null ? ` · ${eur(p.forecastCost)}` : ''}
              </Text>
            </Group>
          )}
          {o.previousPeriod?.total !== null && o.previousPeriod && (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Vorperiode {o.previousPeriod.label}
              </Text>
              <Text size="sm" c="dimmed" className="tabular">
                {num(o.previousPeriod.total, 0)} {m.unit}
                {o.previousPeriod.cost ? ` · ${eur(o.previousPeriod.cost.total)}` : ''}
              </Text>
            </Group>
          )}
          {p.balance !== null && (
            <Group justify="space-between">
              <Text size="sm">Voraussichtlich</Text>
              <Badge color={p.balance > 0 ? 'red' : 'green'} variant="light">
                {p.balance > 0 ? `Nachzahlung ${eur(p.balance)}` : `Guthaben ${eur(-p.balance)}`}
              </Badge>
            </Group>
          )}
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Ø pro Tag (30 Tage / Jahr)
            </Text>
            <Text size="sm" c="dimmed" className="tabular">
              {num(day30, 2)} / {num(dayYear, 2)} {m.unit}
            </Text>
          </Group>
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          Für Auswertungen werden mindestens zwei Ablesungen gebraucht.
        </Text>
      )}

      <Group mt="md" grow>
        <Button leftSection={<IconCamera size={16} />} onClick={onCapture}>
          Ablesen
        </Button>
        <Button variant="default" component={Link} to={`/meters/${m.id}`}>
          Details
        </Button>
      </Group>
    </Card>
  );
}
