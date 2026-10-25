import { Alert, Anchor, Badge, Button, Card, Group, SegmentedControl, Stack, Switch, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBell, IconCamera } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import { get, post, put } from '../lib/api';
import type { ReminderInterval, ReminderState } from '../lib/types';

/** z. B. „Montag, 26. Oktober, 9 Uhr“ */
export const reminderDate = (iso: string) => dayjs(iso).format('dddd, D. MMMM, H [Uhr]');

export function useReminder() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['reminder'], queryFn: () => get<ReminderState>('/me/reminder') });
  const onDone = (data: ReminderState) => qc.setQueryData(['reminder'], data);
  const onError = (e: unknown) => notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Fehler' });
  const update = useMutation({
    mutationFn: (patch: { interval?: ReminderInterval; email?: boolean }) => put<ReminderState>('/me/reminder', patch),
    onSuccess: onDone,
    onError,
  });
  const skip = useMutation({
    mutationFn: (which: 'current' | 'next' | 'none') => post<ReminderState>('/me/reminder/skip', { which }),
    onSuccess: onDone,
    onError,
  });
  return { state, update, skip };
}

/** Einstellungen: Rhythmus, E-Mail, Termine überspringen. */
export function ReminderSettings({ mailAvailable }: { mailAvailable: boolean }) {
  const { state, update, skip } = useReminder();
  const r = state.data;
  if (!r) return null;
  const skippingNext = !!r.skipUntil && !!r.next && r.skipUntil >= r.next;

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group gap="xs">
          <IconBell size={18} />
          <Text fw={600}>Erinnerung ans Ablesen</Text>
        </Group>
        <SegmentedControl
          value={r.interval}
          onChange={(v) => update.mutate({ interval: v as ReminderInterval })}
          data={[
            { value: 'OFF', label: 'Aus' },
            { value: 'WEEKLY', label: 'Wöchentlich' },
            { value: 'MONTHLY', label: 'Monatlich' },
          ]}
        />
        {r.interval !== 'OFF' && (
          <>
            <Text size="sm" c="dimmed">
              {r.interval === 'WEEKLY' ? 'Jeden Montag um 9 Uhr' : 'Am 1. jedes Monats um 9 Uhr'} – in der App so lange, bis alle Zähler abgelesen sind.
              Wer schon am Vortag abliest, wird gar nicht erst erinnert.
            </Text>
            <Switch
              checked={r.email}
              onChange={(e) => update.mutate({ email: e.currentTarget.checked })}
              label="Auch per E-Mail erinnern"
              description={mailAvailable ? 'Eine E-Mail je Termin' : 'Auf diesem Server ist kein E-Mail-Versand eingerichtet'}
            />
            {r.active && (
              <Alert color="blue" variant="light" p="sm">
                <Text size="sm">Gerade fällig: {r.due.map((d) => d.name).join(', ')}</Text>
                <Button size="xs" variant="default" mt="xs" loading={skip.isPending} onClick={() => skip.mutate('current')}>
                  Diesmal überspringen
                </Button>
              </Alert>
            )}
            {r.next && (
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Text size="sm">
                  Nächste Erinnerung: {reminderDate(r.next)}
                  {skippingNext && (
                    <Badge ml="xs" color="orange" variant="light">
                      wird übersprungen
                    </Badge>
                  )}
                </Text>
                {skippingNext || (r.skipped && !r.active) ? (
                  <Anchor component="button" size="sm" onClick={() => skip.mutate('none')}>
                    Doch erinnern
                  </Anchor>
                ) : (
                  <Anchor component="button" size="sm" onClick={() => skip.mutate('next')}>
                    Überspringen
                  </Anchor>
                )}
              </Group>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}

/** Hinweis auf der Übersicht, solange eine Erinnerung offen ist. */
export function ReminderAlert() {
  const { state, skip } = useReminder();
  const r = state.data;
  if (!r?.active) return null;
  return (
    <Alert color="yellow" variant="light" icon={<IconBell size={18} />}>
      <Group justify="space-between" gap="xs">
        <Text size="sm">
          Zeit zum Ablesen: <b>{r.due.map((d) => d.name).join(', ')}</b>
        </Text>
        <Group gap="xs">
          <Button size="xs" component={Link} to="/ablesen" leftSection={<IconCamera size={14} />}>
            Ablesen
          </Button>
          <Button size="xs" variant="default" loading={skip.isPending} onClick={() => skip.mutate('current')}>
            Überspringen
          </Button>
        </Group>
      </Group>
    </Alert>
  );
}
