import { Card, Center, Group, Loader, SegmentedControl, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '../../lib/api';
import { eur, num } from '../../lib/format';
import { type MonthSlot, monthAxisLabels, periodStarts } from '../../lib/monthAxis';
import { type ChartGranularity, getChartGranularity, setChartGranularity } from '../../lib/prefs';
import type { Meter, SeriesBucket } from '../../lib/types';

const HUES = ['blue', 'teal', 'grape', 'orange'];
/** Je Zählwerk eine Farbe; die übergeordnete Periode (Woche, Monat, Jahr) wechselt zwischen dunkel und hell. */
const color = (i: number, band = 0) => `var(--mantine-color-${HUES[i % HUES.length]}-${band ? 3 : 7})`;
const SO_FAR = 'Bisher';
const FORECAST = 'Prognose';
const GRAY = 'var(--mantine-color-gray-6)';
const GRAY_LIGHT = 'var(--mantine-color-gray-4)';

export function ChartTab({ meter }: { meter: Meter }) {
  const [granularity, setGranularityState] = useState<ChartGranularity>(getChartGranularity);
  const setGranularity = (g: string) => {
    setGranularityState(g as ChartGranularity);
    setChartGranularity(g as ChartGranularity);
  };
  const [showCost, setShowCost] = useState(false);
  // Auf dem Handy passen fünf Einteilungen nur mit kurzen Namen in eine Zeile
  const narrow = useMediaQuery('(max-width: 30em)');
  const q = useQuery({
    queryKey: ['series', meter.id, granularity],
    queryFn: () => get<{ buckets: SeriesBucket[] }>(`/stats/meters/${meter.id}/series?granularity=${granularity}`),
  });
  const buckets = q.data?.buckets ?? [];
  const anyEstimated = buckets.some((b) => Object.values(b.registers).some((r) => r.estimated || (r.partial && !b.current)));
  const hasCost = buckets.some((b) => b.cost !== null);

  const hasCurrent = buckets.some((b) => b.current);

  const data = buckets.map((b) => {
    // Die laufende Periode ist immer nur teilweise abgedeckt – dafür gibt es den grauen Prognose-Balken.
    const est = Object.values(b.registers).some((r) => r.estimated || (r.partial && !b.current));
    const row: Record<string, string | number | null> = { label: est ? `${b.label}*` : b.label, band: b.band };
    const start = new Date(b.start);
    row.month = start.getMonth();
    row.period = b.period ?? String(start.getFullYear());
    if (b.current) {
      // Laufende Periode: bisheriger Verbrauch grau, darüber hell der Rest bis zur Prognose
      const soFar = (showCost ? b.cost : b.total) ?? 0;
      const forecast = showCost ? b.forecastCost : b.forecastTotal;
      row[SO_FAR] = soFar || null;
      row[FORECAST] = forecast !== null ? Math.max(0, forecast - soFar) : null;
      row.forecastTotal = forecast;
    } else if (showCost) row['Kosten'] = b.cost;
    else for (const r of meter.registers) row[r.name] = b.registers[r.id]?.value ?? null;
    row['Vorjahr'] = showCost ? null : b.previousYearTotal;
    return row;
  });
  const unit = showCost ? '€' : meter.unit;
  const fmt = (v: number) => `${num(v, showCost ? 2 : 1)} ${unit}`;

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
          size={narrow ? 'xs' : 'sm'}
          fullWidth={narrow}
          data={[
            { value: 'day', label: 'Tage' },
            { value: 'week', label: 'Wochen' },
            { value: 'month', label: 'Monate' },
            { value: 'year', label: 'Jahre' },
            { value: 'billing', label: narrow ? 'Abrechn.' : 'Abrechnungsjahre' },
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
                tick={
                  granularity === 'month'
                    ? (p: MonthTickProps) => <MonthTick {...p} rows={data as unknown as MonthSlot[]} />
                    : { fontSize: 12, fill: 'var(--mantine-color-dimmed)' }
                }
                tickLine={false}
                axisLine={false}
                interval={granularity === 'month' ? 0 : 'preserveStartEnd'}
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
                formatter={(v, name, item) => {
                  if (name === FORECAST) {
                    const f = (item.payload as { forecastTotal?: number | null }).forecastTotal;
                    return [typeof f === 'number' ? fmt(f) : '–', 'Prognose gesamt'];
                  }
                  return [typeof v === 'number' ? fmt(v) : '–', name];
                }}
                contentStyle={{ background: 'var(--mantine-color-body)', border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}
                cursor={{ fill: 'var(--mantine-color-default-hover)' }}
              />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              {showCost ? (
                <Bar dataKey="Kosten" stackId="a" fill={color(0)} maxBarSize={40} radius={[3, 3, 0, 0]}>
                  {data.map((d, k) => (
                    <Cell key={k} fill={color(0, Number(d.band))} />
                  ))}
                </Bar>
              ) : (
                meter.registers.map((r, i) => (
                  <Bar key={r.id} dataKey={r.name} stackId="a" fill={color(i)} maxBarSize={40}>
                    {data.map((d, k) => (
                      <Cell key={k} fill={color(i, Number(d.band))} />
                    ))}
                  </Bar>
                ))
              )}
              {hasCurrent && <Bar dataKey={SO_FAR} stackId="a" fill={GRAY} maxBarSize={40} />}
              {hasCurrent && (
                <Bar
                  dataKey={FORECAST}
                  stackId="a"
                  fill={GRAY_LIGHT}
                  fillOpacity={0.45}
                  stroke={GRAY}
                  strokeDasharray="4 3"
                  maxBarSize={40}
                />
              )}
              {!showCost && (
                <Line dataKey="Vorjahr" stroke="var(--mantine-color-gray-6)" strokeDasharray="4 3" dot={false} strokeWidth={2} connectNulls={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {hasCurrent && (
          <Text size="xs" c="dimmed" mt="xs">
            Grau: {PERIOD_NAME[granularity]} – dunkel der Verbrauch bis zur letzten Ablesung, hell gestrichelt die Prognose bis zum Ende.
          </Text>
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

interface MonthTickProps {
  x?: number;
  y?: number;
  index?: number;
  width?: number;
}

/**
 * Monatsachse: Alle Beschriftungen hängen an der ersten Säule und werden über die
 * Säulenbreite positioniert – Periode (Kalender- oder Heizjahr) am Anfang, letzter Monat am Ende.
 */
function MonthTick({ x = 0, y = 0, index = 0, width = 0, rows }: MonthTickProps & { rows: MonthSlot[] }) {
  if (index !== 0 || rows.length === 0) return <g />;
  const slot = width / rows.length;
  const left = x - slot / 2;
  return (
    <g>
      {periodStarts(rows).map((k) => (
        // Trennstrich an der Grenze zweier Perioden
        <line key={`sep-${k}`} x1={left + k * slot} x2={left + k * slot} y1={y - 2} y2={y + 14} stroke="var(--mantine-color-default-border)" />
      ))}
      {monthAxisLabels(rows, slot).map((l) => (
        <text
          key={`${l.text}-${l.at}`}
          x={left + l.at * slot}
          y={y}
          dy={12}
          textAnchor={l.anchor}
          fontSize={12}
          fill="var(--mantine-color-dimmed)"
          fontWeight={l.strong ? 600 : undefined}
        >
          {l.text}
        </text>
      ))}
    </g>
  );
}

const PERIOD_NAME: Record<ChartGranularity, string> = {
  day: 'laufender Tag',
  week: 'laufende Woche',
  month: 'laufender Monat',
  year: 'laufendes Jahr',
  billing: 'laufende Abrechnungsperiode',
};

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
