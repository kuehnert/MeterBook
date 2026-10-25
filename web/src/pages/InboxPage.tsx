import { Badge, Button, Card, Center, Group, Loader, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { IconCamera, IconCheck } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AuthImage } from '../components/AuthImage';
import { PhotoReview } from '../components/PhotoReview';
import { get } from '../lib/api';
import { dateTime } from '../lib/format';
import type { InboxItem, Meter } from '../lib/types';

/** Fotos im Eingang; solange noch erkannt wird, alle 3 Sekunden nachsehen. */
export function useInbox() {
  return useQuery({
    queryKey: ['inbox'],
    queryFn: () => get<InboxItem[]>('/photos/inbox'),
    refetchInterval: (q) => ((q.state.data ?? []).some((i) => i.ocrStatus === 'PENDING') ? 3000 : 30_000),
  });
}

export function statusOf(item: InboxItem, meters: Meter[] | undefined): { label: string; color: string; ready: boolean } {
  if (item.ocrStatus === 'PENDING') return { label: 'wird erkannt …', color: 'blue', ready: false };
  const meter = meters?.find((m) => m.id === item.meterId);
  if (item.ocrStatus === 'FAILED') return { label: 'nicht erkannt', color: 'orange', ready: true };
  if (!meter) return { label: 'Zähler wählen', color: 'orange', ready: true };
  return { label: meter.name, color: 'green', ready: true };
}

/**
 * Eingang: Fotos, die noch geprüft werden müssen. Die Erkennung läuft im Hintergrund;
 * fertige Fotos werden der Reihe nach geprüft und gespeichert.
 */
export function InboxPage() {
  const inbox = useInbox();
  const meters = useQuery({ queryKey: ['meters'], queryFn: () => get<Meter[]>('/meters') });
  const [openId, setOpenId] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const items = inbox.data ?? [];
  const open = items.find((i) => i.photoId === openId) ?? null;

  // Das geöffnete Foto ist erledigt (gespeichert/verworfen) → Liste
  useEffect(() => {
    if (openId && inbox.data && !inbox.data.some((i) => i.photoId === openId)) setOpenId(null);
  }, [inbox.data, openId]);

  /** Nach dem Speichern direkt das nächste fertige Foto öffnen */
  const next = (savedName?: string) => {
    if (savedName) setLastSaved(savedName);
    const rest = items.filter((i) => i.photoId !== openId && i.ocrStatus !== 'PENDING');
    setOpenId(rest[0]?.photoId ?? null);
  };

  if (open && open.ocrStatus !== 'PENDING') {
    return (
      <Stack maw={520} mx="auto" pb={100}>
        <Group justify="space-between">
          <Title order={3}>Foto prüfen</Title>
          <Text size="sm" c="dimmed">
            {items.findIndex((i) => i.photoId === open.photoId) + 1} von {items.length}
          </Text>
        </Group>
        <PhotoReview key={open.photoId} item={open} onSaved={(name) => next(name)} onCancel={() => setOpenId(null)} onDiscarded={() => next()} />
      </Stack>
    );
  }

  return (
    <Stack maw={620} mx="auto">
      <Group justify="space-between">
        <Title order={2}>Eingang</Title>
        <Button component={Link} to="/ablesen" leftSection={<IconCamera size={16} />} variant="light">
          Fotografieren
        </Button>
      </Group>
      {lastSaved && (
        <Text size="sm" c="green.7">
          <IconCheck size={14} /> {lastSaved} gespeichert
        </Text>
      )}
      {inbox.isLoading && (
        <Center h={120}>
          <Loader />
        </Center>
      )}
      {!inbox.isLoading && items.length === 0 && (
        <Card withBorder p="xl">
          <Text c="dimmed" ta="center">
            Keine Fotos zu prüfen.
          </Text>
        </Card>
      )}
      {items.map((item) => {
        const st = statusOf(item, meters.data);
        return (
          <UnstyledButton key={item.photoId} onClick={() => st.ready && setOpenId(item.photoId)} disabled={!st.ready}>
            <Card withBorder padding="sm">
              <Group wrap="nowrap">
                <AuthImage photoId={item.photoId} thumb w={72} h={72} />
                <Stack gap={2} style={{ flex: 1 }}>
                  <Group gap="xs">
                    <Badge color={st.color} variant="light" leftSection={item.ocrStatus === 'PENDING' ? <Loader size={10} /> : undefined}>
                      {st.label}
                    </Badge>
                  </Group>
                  <Text size="sm">{dateTime(item.takenAt)}</Text>
                  {st.ready && (
                    <Text size="xs" c="dimmed">
                      Antippen zum Prüfen
                    </Text>
                  )}
                </Stack>
              </Group>
            </Card>
          </UnstyledButton>
        );
      })}
    </Stack>
  );
}
