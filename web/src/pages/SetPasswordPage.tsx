import { Alert, Button, Center, Loader, PasswordInput, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { publicPost, setPasswordWithLink } from '../lib/api';
import { AuthCard } from './LoginPage';

interface LinkInfo {
  purpose: 'INVITE' | 'RESET';
  email: string;
  name: string;
}

/** Ziel der Links aus Einladung und „Passwort vergessen“: Passwort festlegen und direkt loslegen. */
export function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ['auth-link', token],
    queryFn: () => publicPost<LinkInfo>('/auth/link', { token }),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== repeat) return setError('Die Passwörter stimmen nicht überein.');
    setBusy(true);
    setError(null);
    try {
      await setPasswordWithLink(token, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Das hat nicht geklappt');
    } finally {
      setBusy(false);
    }
  };

  const toLogin = (
    <Button variant="default" onClick={() => navigate('/', { replace: true })}>
      Zur Anmeldung
    </Button>
  );

  if (!token || info.isError) {
    return (
      <AuthCard>
        <Alert color="orange">
          {info.error instanceof Error ? info.error.message : 'Der Link ist unvollständig.'} Unter „Passwort vergessen?“ bekommst du einen neuen.
        </Alert>
        {toLogin}
      </AuthCard>
    );
  }
  if (!info.data) {
    return (
      <AuthCard>
        <Center h={80}>
          <Loader />
        </Center>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <form onSubmit={submit}>
        <Stack>
          <Text size="sm">
            {info.data.purpose === 'INVITE' ? `Willkommen, ${info.data.name}! ` : `Hallo ${info.data.name}, `}
            {info.data.purpose === 'INVITE' ? 'Lege dein Passwort fest, dann geht’s los.' : 'lege ein neues Passwort fest.'}
          </Text>
          <Text size="sm" c="dimmed">
            Anmelden wirst du dich mit <b>{info.data.email}</b>.
          </Text>
          {error && <Alert color="red">{error}</Alert>}
          {/* Unsichtbares Nutzerfeld, damit Passwort-Manager die Adresse zum neuen Passwort speichern */}
          <input type="email" autoComplete="username" value={info.data.email} readOnly hidden />
          <PasswordInput
            label="Neues Passwort"
            description="Mindestens 8 Zeichen"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <PasswordInput label="Wiederholen" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.currentTarget.value)} />
          <Button type="submit" loading={busy} fullWidth>
            Passwort speichern und anmelden
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
