import { Alert, Anchor, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { IconGauge, IconMailCheck } from '@tabler/icons-react';
import { useState } from 'react';
import { login, publicPost } from '../lib/api';

export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={380}>
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
          {children}
        </Stack>
      </Paper>
    </Center>
  );
}

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'forgot' | 'sent'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (e: React.FormEvent, action: () => Promise<void>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Das hat nicht geklappt');
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'sent') {
    return (
      <AuthCard>
        <Alert color="green" icon={<IconMailCheck size={18} />}>
          Wenn es zu <b>{email}</b> ein Konto gibt, ist jetzt eine E-Mail mit einem Link unterwegs. Der Link gilt eine Stunde.
        </Alert>
        <Text size="sm" c="dimmed">
          Nichts angekommen? Schau auch im Spam-Ordner nach.
        </Text>
        <Button variant="default" onClick={() => setMode('login')}>
          Zurück zur Anmeldung
        </Button>
      </AuthCard>
    );
  }

  if (mode === 'forgot') {
    return (
      <AuthCard>
        <form
          onSubmit={(e) =>
            run(e, async () => {
              await publicPost('/auth/forgot', { email });
              setMode('sent');
            })
          }
        >
          <Stack>
            <Text size="sm">Gib deine E-Mail-Adresse ein – du bekommst einen Link, mit dem du ein neues Passwort festlegst.</Text>
            {error && <Alert color="red">{error}</Alert>}
            <TextInput
              label="E-Mail"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <Button type="submit" loading={busy} fullWidth>
              Link senden
            </Button>
            <Anchor component="button" type="button" size="sm" onClick={() => setMode('login')}>
              Zurück zur Anmeldung
            </Anchor>
          </Stack>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <form onSubmit={(e) => run(e, () => login(email, password))}>
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <TextInput
            label="E-Mail"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <PasswordInput
            label="Passwort"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <Button type="submit" loading={busy} fullWidth>
            Anmelden
          </Button>
          <Anchor
            component="button"
            type="button"
            size="sm"
            onClick={() => {
              setError(null);
              setMode('forgot');
            }}
          >
            Passwort vergessen?
          </Anchor>
        </Stack>
      </form>
    </AuthCard>
  );
}
