import { AppShell, Burger, Group, NavLink, ScrollArea, Text, ThemeIcon, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconDashboard,
  IconFileReport,
  IconGauge,
  IconLogout,
  IconPlus,
  IconSettings,
  IconCamera,
  IconInbox,
  IconShieldCheck,
  IconUsers,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { MediumIcon } from './components/MediumIcon';
import { User, currentUser, get, logout, onAuthChange } from './lib/api';
import type { Meter } from './lib/types';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { MeterPage } from './pages/MeterPage';
import { NewMeterPage } from './pages/NewMeterPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';
import { BackupPage } from './pages/BackupPage';
import { CapturePage } from './pages/CapturePage';
import { InboxPage, useInbox } from './pages/InboxPage';
import { Badge } from '@mantine/core';
import type { Health } from './lib/types';

export function App() {
  const [user, setUser] = useState<User | null>(currentUser());
  const qc = useQueryClient();
  useEffect(
    () =>
      onAuthChange((u) => {
        setUser(u);
        if (!u) qc.clear();
      }),
    [qc],
  );
  if (!user) return <LoginPage />;
  return <Shell user={user} />;
}

function Shell({ user }: { user: User }) {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const meters = useQuery({ queryKey: ['meters'], queryFn: () => get<Meter[]>('/meters') });
  const health = useQuery({ queryKey: ['health'], queryFn: () => get<Health>('/health'), staleTime: Infinity });
  useEffect(close, [location.pathname, close]);

  const inbox = useInbox();
  const inboxCount = inbox.data?.length ?? 0;

  const link = (to: string, label: string, icon: React.ReactNode, exact = false, badge?: number) => {
    const active = exact ? location.pathname === to : location.pathname.startsWith(to);
    return (
      <NavLink
        component={Link}
        to={to}
        label={label}
        leftSection={icon}
        rightSection={badge ? <Badge size="sm" circle>{badge}</Badge> : undefined}
        active={active}
        classNames={{ label: active ? 'nav-link-active' : undefined }}
      />
    );
  };

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 250, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menü" />
            <ThemeIcon size="md" radius="md">
              <IconGauge size={18} />
            </ThemeIcon>
            <Title order={4}>MeterBook</Title>
            {health.data?.env && (
              <Badge color="orange" variant="filled">
                {health.data.env}
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed" visibleFrom="xs">
            {user.name}
          </Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea}>
          {link('/', 'Übersicht', <IconDashboard size={18} />, true)}
          {link('/ablesen', 'Ablesen', <IconCamera size={18} />, true)}
          {link('/eingang', 'Eingang', <IconInbox size={18} />, true, inboxCount)}
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" px="sm" pt="md" pb={4}>
            Zähler
          </Text>
          {meters.data?.map((m) => (
            <span key={m.id}>{link(`/meters/${m.id}`, m.name, <MediumIcon meter={m} size={18} />)}</span>
          ))}
          {link('/meters/new', 'Zähler hinzufügen', <IconPlus size={18} />, true)}
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" px="sm" pt="md" pb={4}>
            Verwaltung
          </Text>
          {link('/reports', 'Berichte & Export', <IconFileReport size={18} />)}
          {link('/settings', 'Einstellungen', <IconSettings size={18} />)}
          {user.role === 'ADMIN' && link('/users', 'Nutzer', <IconUsers size={18} />)}
          {user.role === 'ADMIN' && link('/backup', 'Sicherung', <IconShieldCheck size={18} />)}
        </AppShell.Section>
        <AppShell.Section>
          <NavLink label="Abmelden" leftSection={<IconLogout size={18} />} onClick={() => void logout()} />
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/ablesen" element={<CapturePage />} />
          <Route path="/eingang" element={<InboxPage />} />
          <Route path="/meters/new" element={<NewMeterPage />} />
          <Route path="/meters/:id/*" element={<MeterPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {user.role === 'ADMIN' && <Route path="/users" element={<UsersPage />} />}
          {user.role === 'ADMIN' && <Route path="/backup" element={<BackupPage />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
