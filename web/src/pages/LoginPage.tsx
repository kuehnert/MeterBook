import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { IconGauge } from '@tabler/icons-react';
import { useState } from 'react';
import { login } from '../lib/api';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={380}>
        <form onSubmit={submit}>
          <Stack>
            <Stack gap={4} align="center">
              <ThemeIcon size={48} radius="md">
                <IconGauge size={28} />
              </ThemeIcon>
              <Title order={3}>MeterBook</Title>
              <Text size="sm" c="dimmed">
                Zählerstände und Verbrauch
              </Text>
            </Stack>
            {error && <Alert color="red">{error}</Alert>}
            <TextInput label="E-Mail" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <PasswordInput label="Passwort" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            <Button type="submit" loading={busy} fullWidth>
              Anmelden
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
