import { Card, Center, Group, Loader, SegmentedControl, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '../../lib/api';
import { eur, num } from '../../lib/format';
import type { Meter, SeriesBucket } from '../../lib/types';

const COLORS = ['blue', 'teal', 'grape', 'orange'].map((c) => `var(--mantine-color-${c}-6)`);

export function ChartTab({ meter }: { meter: Meter }) {
  const [granularity, setGranularity] = useState('month');
  const [showCost, setShowCost] = useState(false);
  const q = useQuery({
    queryKey: ['series', meter.id, granularity],
    queryFn: () => get<{ buckets: SeriesBucket[] }>(`/stats/meters/${meter.id}/series?granularity=${granularity}`),
  });
  const buckets = q.data?.buckets ?? [];
  const anyEstimated = buckets.some((b) => Object.values(b.registers).some((r) => r.estimated || r.partial));
  const hasCost = buckets.some((b) => b.cost !== null);

  const data = buckets.map((b) => {
    const est = Object.values(b.registers).some((r) => r.estimated || r.partial);
    const row: Record<string, string | number | null> = { label: est ? `${b.label}*` : b.label };
    if (showCost) row['Kosten'] = b.cost;
    else for (const r of meter.registers) row[r.name] = b.registers[r.id]?.value ?? null;
    row['Vorjahr'] = showCost ? null : b.previousYearTotal;
    return row;
  });

  const withData = buckets.filter((b) => b.total !== null);
  const total = withData.reduce((s, b) => s + (b.total ?? 0), 0);
  const costTotal = withData.reduce((s, b) => s + (b.cost ?? 0), 0);
  const perDay = withData.length ? withData.reduce((s, b) => s + (b.perDay ?? 0), 0) / withData.length : null;

  return (
    <Stack>
      <Group justify="space-between">
        <SegmentedControl
          value={granularity}
          onChange={setGranularity}
          data={[
            { value: 'day', label: 'Tage' },
            { value: 'week', label: 'Wochen' },
            { value: 'month', label: 'Monate' },
            { value: 'year', label: 'Jahre' },
            { value: 'billing', label: 'Abrechnungsjahre' },
          ]}
        />
        {hasCost && <Switch label="Kosten anzeigen" checked={showCost} onChange={(e) => setShowCost(e.currentTarget.checked)} />}
      </Group>

      <SimpleGrid cols={{ base: 1, xs: 3 }}>
        <Stat label="Verbrauch im Zeitraum" value={`${num(total, 0)} ${meter.unit}`} />
        <Stat label="Ø pro Tag" value={`${num(perDay, 2)} ${meter.unit}`} />
        <Stat label="Kosten im Zeitraum" value={hasCost ? eur(costTotal) : '–'} />
      </SimpleGrid>

      <Card withBorder>
        {q.isLoading ? (
          <Center h={320}><Loader /></Center>
        ) : buckets.length === 0 ? (
          <Center h={200}>
            <Text c="dimmed">Für den Verlauf werden mindestens zwei Ablesungen gebraucht.</Text>
          </Center>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--mantine-color-default-border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: 'var(--mantine-color-dimmed)' }}
                tickLine={false}
                axisLine={false}
                minTickGap={8}
                // Tage: Jahreszahl auf der Achse weglassen (steht im Tooltip)
                tickFormatter={(v: string) => (granularity === 'day' ? v.replace(/\d{4}/, '') : v)}
              />
              <YAxis
                tick={{ fontSize: 12, fill: 'var(--mantine-color-dimmed)' }}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v: number) => num(v, 0)}
              />
              <Tooltip
                formatter={(v) => (typeof v === 'number' ? `${num(v, showCost ? 2 : 1)} ${showCost ? '€' : meter.unit}` : '–')}
                contentStyle={{ background: 'var(--mantine-color-body)', border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}
                cursor={{ fill: 'var(--mantine-color-default-hover)' }}
              />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              {showCost ? (
                <Bar dataKey="Kosten" fill={COLORS[0]} maxBarSize={40} radius={[3, 3, 0, 0]} />
              ) : (
                meter.registers.map((r, i) => (
                  <Bar key={r.id} dataKey={r.name} stackId="a" fill={COLORS[i % COLORS.length]} maxBarSize={40} />
                ))
              )}
              {!showCost && (
                <Line dataKey="Vorjahr" stroke="var(--mantine-color-gray-6)" strokeDasharray="4 3" dot={false} strokeWidth={2} connectNulls={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {anyEstimated && (
          <Text size="xs" c="dimmed" mt="xs">
            * geschätzt: Zwischen den Ablesungen liegen mehr als 45 Tage oder der Zeitraum ist nur teilweise abgedeckt. Häufigeres Ablesen macht die Werte genauer.
          </Text>
        )}
      </Card>
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600} size="lg" className="tabular">
        {value}
      </Text>
    </Card>
  );
}
