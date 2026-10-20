import { ActionIcon, Button, Card, Group, Modal, NumberInput, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconArchive, IconReplace, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MeterForm, toFormValues, toPayload } from '../../components/MeterForm';
import { del, get, patch, post } from '../../lib/api';
import { dateTime, num } from '../../lib/format';
import type { Exchange, Meter } from '../../lib/types';

export function SettingsTab({ meter }: { meter: Meter }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const exchanges = useQuery({ queryKey: ['exchanges', meter.id], queryFn: () => get<Exchange[]>(`/meters/${meter.id}/exchanges`) });
  const [ex, setEx] = useState<{ at: string; serial: string; note: string; values: Record<string, { old: number | ''; neu: number | '' }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Fehler' });

  const saveExchange = async () => {
    if (!ex) return;
    setBusy(true);
    try {
      await post(`/meters/${meter.id}/exchanges`, {
        exchangedAt: dayjs(ex.at).toISOString(),
        newSerialNumber: ex.serial || undefined,
        note: ex.note || undefined,
        values: meter.registers.map((r) => ({
          registerId: r.id,
          oldFinalValue: Number(ex.values[r.id]?.old || 0),
          newInitialValue: Number(ex.values[r.id]?.neu || 0),
        })),
      });
      await qc.invalidateQueries();
      notifications.show({ color: 'green', message: 'Gerätewechsel gespeichert' });
      setEx(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack maw={860}>
      <Card withBorder>
        <Title order={4} mb="sm">
          Zähler bearbeiten
        </Title>
        <MeterForm
          key={meter.id}
          initial={toFormValues(meter)}
          submitLabel="Änderungen speichern"
          onSubmit={async (v) => {
            try {
              await patch(`/meters/${meter.id}`, toPayload(v));
              await qc.invalidateQueries();
              notifications.show({ color: 'green', message: 'Gespeichert' });
            } catch (e) {
              fail(e);
            }
          }}
        />
      </Card>

      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <div>
            <Title order={4}>Gerätewechsel</Title>
            <Text size="sm" c="dimmed">
              Wurde der Zähler getauscht, trage End- und Anfangsstand ein. Die Verbrauchsreihe läuft dann ohne Sprung weiter.
            </Text>
          </div>
          <Button
            variant="default"
            leftSection={<IconReplace size={16} />}
            onClick={() =>
              setEx({
                at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                serial: '',
                note: '',
                values: Object.fromEntries(meter.registers.map((r) => [r.id, { old: r.lastReading?.value ?? '', neu: 0 }])),
              })
            }
          >
            Wechsel erfassen
          </Button>
        </Group>
        {(exchanges.data?.length ?? 0) > 0 && (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Zeitpunkt</Table.Th>
                <Table.Th>Zählwerk</Table.Th>
                <Table.Th ta="right">Endstand alt</Table.Th>
                <Table.Th ta="right">Anfangsstand neu</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {exchanges.data!.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>{dateTime(e.exchangedAt)}</Table.Td>
                  <Table.Td>{meter.registers.find((r) => r.id === e.registerId)?.name}</Table.Td>
                  <Table.Td ta="right" className="tabular">
                    {num(e.oldFinalValue, 1)}
                  </Table.Td>
                  <Table.Td ta="right" className="tabular">
                    {num(e.newInitialValue, 1)}
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label="Löschen"
                      onClick={() =>
                        modals.openConfirmModal({
                          title: 'Gerätewechsel löschen?',
                          labels: { confirm: 'Löschen', cancel: 'Abbrechen' },
                          confirmProps: { color: 'red' },
                          onConfirm: async () => {
                            try {
                              await del(`/meters/${meter.id}/exchanges/${e.id}`);
                              await qc.invalidateQueries();
                            } catch (err) {
                              fail(err);
                            }
                          },
                        })
                      }
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">
          Zähler entfernen
        </Title>
        <Group>
          <Button
            variant="default"
            leftSection={<IconArchive size={16} />}
            onClick={async () => {
              try {
                await patch(`/meters/${meter.id}`, { archived: !meter.archived });
                await qc.invalidateQueries();
                notifications.show({ message: meter.archived ? 'Zähler wieder aktiv' : 'Zähler archiviert' });
              } catch (e) {
                fail(e);
              }
            }}
          >
            {meter.archived ? 'Wieder aktivieren' : 'Archivieren'}
          </Button>
          <Button
            color="red"
            variant="light"
            leftSection={<IconTrash size={16} />}
            onClick={() =>
              modals.openConfirmModal({
                title: `${meter.name} endgültig löschen?`,
                children: (
                  <Text size="sm">
                    Alle Ablesungen, Fotos, Tarife und Abschläge dieses Zählers werden gelöscht. Das lässt sich nicht rückgängig machen. Zum Aufbewahren lieber archivieren.
                  </Text>
                ),
                labels: { confirm: 'Endgültig löschen', cancel: 'Abbrechen' },
                confirmProps: { color: 'red' },
                onConfirm: async () => {
                  try {
                    await del(`/meters/${meter.id}`);
                    await qc.invalidateQueries();
                    navigate('/');
                  } catch (e) {
                    fail(e);
                  }
                },
              })
            }
          >
            Löschen
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          Archivierte Zähler erscheinen nicht mehr in der Übersicht, ihre Daten bleiben für Berichte erhalten.
        </Text>
      </Card>

      <Modal opened={!!ex} onClose={() => setEx(null)} title="Gerätewechsel erfassen">
        {ex && (
          <Stack>
            <DateTimePicker label="Zeitpunkt des Wechsels" value={ex.at} onChange={(v) => v && setEx({ ...ex, at: dayjs(v).format('YYYY-MM-DD HH:mm:ss') })} valueFormat="DD.MM.YYYY HH:mm" />
            {meter.registers.map((r) => (
              <Group key={r.id} grow>
                <NumberInput
                  label={`Endstand alt${meter.registers.length > 1 ? ` (${r.name})` : ''}`}
                  value={ex.values[r.id]?.old ?? ''}
                  onChange={(v) => setEx({ ...ex, values: { ...ex.values, [r.id]: { ...ex.values[r.id], old: v === '' ? '' : Number(v) } } })}
                  decimalSeparator=","
                  thousandSeparator="."
                  decimalScale={r.decimals}
                  hideControls
                />
                <NumberInput
                  label="Anfangsstand neu"
                  value={ex.values[r.id]?.neu ?? ''}
                  onChange={(v) => setEx({ ...ex, values: { ...ex.values, [r.id]: { ...ex.values[r.id], neu: v === '' ? '' : Number(v) } } })}
                  decimalSeparator=","
                  thousandSeparator="."
                  decimalScale={r.decimals}
                  hideControls
                />
              </Group>
            ))}
            <TextInput label="Neue Zählernummer" value={ex.serial} onChange={(e) => setEx({ ...ex, serial: e.currentTarget.value })} />
            <TextInput label="Notiz" value={ex.note} onChange={(e) => setEx({ ...ex, note: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEx(null)}>
                Abbrechen
              </Button>
              <Button onClick={saveExchange} loading={busy}>
                Speichern
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
