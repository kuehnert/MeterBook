import { ActionIcon, Badge, Card, Group, Modal, Table, Text, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconEdit, IconPhoto, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthImage } from '../../components/AuthImage';
import { ReadingModal } from '../../components/ReadingModal';
import { del, download, get } from '../../lib/api';
import { dateTime, num } from '../../lib/format';
import type { Meter, ReadingGroup } from '../../lib/types';

const SOURCE: Record<string, { label: string; color: string }> = {
  MANUAL: { label: 'manuell', color: 'gray' },
  PHOTO: { label: 'Foto', color: 'blue' },
  IMPORT: { label: 'Import', color: 'grape' },
};

export function ReadingsTab({ meter }: { meter: Meter }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['readings', meter.id], queryFn: () => get<ReadingGroup[]>(`/meters/${meter.id}/readings`) });
  const [edit, setEdit] = useState<ReadingGroup | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const rows = q.data ?? [];

  const remove = (g: ReadingGroup) =>
    modals.openConfirmModal({
      title: 'Ablesung löschen?',
      children: <Text size="sm">Die Ablesung vom {dateTime(g.readAt)} wird gelöscht. Das Foto bleibt erhalten.</Text>,
      labels: { confirm: 'Löschen', cancel: 'Abbrechen' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await del(`/meters/${meter.id}/readings?readAt=${encodeURIComponent(g.readAt)}`);
          await qc.invalidateQueries();
          notifications.show({ message: 'Ablesung gelöscht' });
        } catch (e) {
          notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Fehler' });
        }
      },
    });

  return (
    <Card withBorder p={0}>
      <Group justify="space-between" p="sm">
        <Text size="sm" c="dimmed">
          {rows.length} Ablesungen
        </Text>
        <Tooltip label="Als CSV herunterladen">
          <ActionIcon variant="subtle" onClick={() => void download(`/meters/${meter.id}/export/csv`, `${meter.name}.csv`)} aria-label="CSV herunterladen">
            <IconDownload size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Table.ScrollContainer minWidth={560}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Zeitpunkt</Table.Th>
              {meter.registers.map((r) => (
                <Table.Th key={r.id} ta="right">
                  {meter.registers.length > 1 ? r.name : 'Stand'} ({meter.unit})
                </Table.Th>
              ))}
              <Table.Th ta="right">Verbrauch seit vorher</Table.Th>
              <Table.Th>Quelle</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((g, i) => {
              const prev = rows[i + 1];
              const delta = prev
                ? meter.registers.reduce((s, r) => {
                    const a = g.values[r.id]?.value;
                    const b = prev.values[r.id]?.value;
                    return a !== undefined && b !== undefined ? s + (a - b) : s;
                  }, 0)
                : null;
              const corrected = meter.registers.some((r) => {
                const v = g.values[r.id];
                return v && v.ocrValue !== null && Math.abs(v.ocrValue - v.value) > 1e-9;
              });
              return (
                <Table.Tr key={g.readAt}>
                  <Table.Td>
                    <Text size="sm">{dateTime(g.readAt)}</Text>
                    {g.note && (
                      <Text size="xs" c="dimmed">
                        {g.note}
                      </Text>
                    )}
                  </Table.Td>
                  {meter.registers.map((r) => (
                    <Table.Td key={r.id} ta="right" className="tabular">
                      {g.values[r.id] ? num(g.values[r.id].value, r.decimals) : '–'}
                    </Table.Td>
                  ))}
                  <Table.Td ta="right" className="tabular" c="dimmed">
                    {delta === null ? '' : delta < 0 ? <Badge color="orange" variant="light">{num(delta, 1)}</Badge> : num(delta, 1)}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      <Badge size="sm" variant="light" color={SOURCE[g.source]?.color}>
                        {SOURCE[g.source]?.label ?? g.source}
                      </Badge>
                      {corrected && (
                        <Tooltip label="Erkannter Wert wurde korrigiert">
                          <Badge size="sm" variant="outline" color="yellow">
                            korrigiert
                          </Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={2} justify="flex-end" wrap="nowrap">
                      {g.photoId && (
                        <ActionIcon variant="subtle" onClick={() => setPhoto(g.photoId)} aria-label="Foto anzeigen">
                          <IconPhoto size={16} />
                        </ActionIcon>
                      )}
                      <ActionIcon variant="subtle" onClick={() => setEdit(g)} aria-label="Bearbeiten">
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" color="red" onClick={() => remove(g)} aria-label="Löschen">
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {rows.length === 0 && !q.isLoading && (
        <Text c="dimmed" ta="center" p="xl">
          Noch keine Ablesungen.
        </Text>
      )}
      <ReadingModal meter={meter} opened={!!edit} edit={edit} onClose={() => setEdit(null)} />
      <Modal opened={!!photo} onClose={() => setPhoto(null)} size="xl" title="Foto">
        {photo && <AuthImage photoId={photo} />}
      </Modal>
    </Card>
  );
}
