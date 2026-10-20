import { Alert, Badge, Button, Card, Group, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { currentUser, get, logout, post } from '../lib/api';
import type { Health } from '../lib/types';

export function SettingsPage() {
  const user = currentUser();
  const health = useQuery({ queryKey: ['health'], queryFn: () => get<Health>('/health'), staleTime: Infinity });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== repeat) {
      setError('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post('/auth/password', { currentPassword: current, newPassword: next });
      notifications.show({ color: 'green', message: 'Passwort geändert – bitte neu anmelden' });
      await logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack maw={560}>
      <Title order={2}>Einstellungen</Title>
      <Card withBorder>
        <Stack gap={4}>
          <Text fw={600}>{user?.name}</Text>
          <Text size="sm" c="dimmed">
            {user?.email}
          </Text>
          <Group gap="xs" mt="xs">
            <Badge variant="light">{user?.role === 'ADMIN' ? 'Administrator' : 'Nutzer'}</Badge>
            {health.data && (
              <Badge variant="light" color={health.data.ocr ? 'green' : 'gray'}>
                Automatische Erkennung {health.data.ocr ? 'aktiv' : 'aus'}
              </Badge>
            )}
            {health.data && <Badge variant="outline" color="gray">Version {health.data.version}</Badge>}
          </Group>
        </Stack>
      </Card>
      <Card withBorder>
        <form onSubmit={change}>
          <Stack>
            <Title order={4}>Passwort ändern</Title>
            <PasswordInput label="Aktuelles Passwort" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} required />
            <PasswordInput label="Neues Passwort" description="Mindestens 8 Zeichen" autoComplete="new-password" value={next} onChange={(e) => setNext(e.currentTarget.value)} required />
            <PasswordInput label="Neues Passwort wiederholen" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.currentTarget.value)} required />
            {error && <Alert color="red">{error}</Alert>}
            <Group justify="flex-end">
              <Button type="submit" loading={busy}>
                Passwort ändern
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
