import { Alert, Badge, Card, Group, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { date, eur, lastDay, num } from '../../lib/format';
import type { BillingPeriod, Meter } from '../../lib/types';

export function BillingTab({ meter }: { meter: Meter }) {
  const q = useQuery({
    queryKey: ['billing', meter.id],
    queryFn: () => get<{ periods: BillingPeriod[] }>(`/stats/meters/${meter.id}/billing`),
  });
  const periods = q.data?.periods ?? [];
  const missing = periods.some((p) => p.cost?.missingTariff);

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        Abrechnungsperiode beginnt am {meter.billingStartDay}.{meter.billingStartMonth}. eines Jahres. Laufende Perioden werden anhand des Vorjahresverlaufs hochgerechnet.
      </Text>
      {missing && <Alert color="orange">Für einen Teil der Zeiträume ist kein Tarif hinterlegt – die Kosten sind dort unvollständig.</Alert>}
      <Card withBorder p={0}>
        <Table.ScrollContainer minWidth={720}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Periode</Table.Th>
                {meter.registers.map((r) => (
                  <Table.Th key={r.id} ta="right">
                    {meter.registers.length > 1 ? r.name : 'Verbrauch'} ({meter.unit})
                  </Table.Th>
                ))}
                <Table.Th ta="right">Kosten</Table.Th>
                <Table.Th ta="right">Abschläge</Table.Th>
                <Table.Th ta="right">Saldo</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {periods.map((p) => (
                <Table.Tr key={p.start}>
                  <Table.Td>
                    <Group gap={6}>
                      <Text fw={600} size="sm">
                        {p.label}
                      </Text>
                      {p.current && <Badge size="xs">laufend</Badge>}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {date(p.start)} – {lastDay(p.end)}
                    </Text>
                  </Table.Td>
                  {meter.registers.map((r) => {
                    const v = p.registers[r.id];
                    return (
                      <Table.Td key={r.id} ta="right" className="tabular">
                        <Text size="sm">{num(v?.value, 0)}</Text>
                        {(v?.estimated || v?.partial) && (
                          <Text size="xs" c="dimmed">
                            {p.current ? 'bisher' : v.partial ? 'unvollständig' : 'geschätzt'}
                          </Text>
                        )}
                      </Table.Td>
                    );
                  })}
                  <Table.Td ta="right" className="tabular">
                    <Text size="sm">{eur(p.cost?.total)}</Text>
                    {p.current && p.forecastCost !== null && (
                      <Text size="xs" c="dimmed">
                        Prognose {eur(p.forecastCost)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td ta="right" className="tabular">
                    <Text size="sm">{p.advances > 0 ? eur(p.advances) : '–'}</Text>
                    {p.current && p.forecastAdvances ? (
                      <Text size="xs" c="dimmed">
                        gesamt {eur(p.forecastAdvances)}
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td ta="right">
                    {p.balance === null ? (
                      '–'
                    ) : (
                      <Badge color={p.balance > 0 ? 'red' : 'green'} variant="light">
                        {p.balance > 0 ? `+${eur(p.balance)}` : eur(p.balance)}
                      </Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {periods.length === 0 && !q.isLoading && (
          <Text c="dimmed" ta="center" p="xl">
            Noch keine Daten.
          </Text>
        )}
      </Card>
      <Text size="xs" c="dimmed">
        Saldo: positiv = (voraussichtliche) Nachzahlung, negativ = Guthaben. Bei laufenden Perioden mit Hochrechnung bis zum Periodenende.
      </Text>
    </Stack>
  );
}
