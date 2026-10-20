import { Button, Center, Group, Loader, Stack, Tabs, Text, ThemeIcon, Title } from '@mantine/core';
import { IconCamera } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { MediumIcon } from '../components/MediumIcon';
import { ReadingModal } from '../components/ReadingModal';
import { get } from '../lib/api';
import { MEDIUM_COLOR, MEDIUM_LABEL } from '../lib/format';
import type { Meter } from '../lib/types';
import { BillingTab } from './meter/BillingTab';
import { ChartTab } from './meter/ChartTab';
import { ReadingsTab } from './meter/ReadingsTab';
import { SettingsTab } from './meter/SettingsTab';
import { TariffsTab } from './meter/TariffsTab';

const TABS = ['verlauf', 'ablesungen', 'abrechnung', 'tarife', 'einstellungen'] as const;

export function MeterPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [capture, setCapture] = useState(false);
  const q = useQuery({ queryKey: ['meter', id], queryFn: () => get<Meter>(`/meters/${id}`) });

  const segment = location.pathname.split('/')[3];
  const tab = (TABS as readonly string[]).includes(segment) ? segment : 'verlauf';

  if (q.isLoading) return <Center h={200}><Loader /></Center>;
  if (!q.data) return <Text>Zähler nicht gefunden.</Text>;
  const m = q.data;

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <ThemeIcon variant="light" color={MEDIUM_COLOR[m.medium]} size="xl">
            <MediumIcon medium={m.medium} size={24} />
          </ThemeIcon>
          <div>
            <Title order={2}>{m.name}</Title>
            <Text size="sm" c="dimmed">
              {[MEDIUM_LABEL[m.medium], m.serialNumber && `Nr. ${m.serialNumber}`, m.location].filter(Boolean).join(' · ')}
            </Text>
          </div>
        </Group>
        <Button leftSection={<IconCamera size={16} />} onClick={() => setCapture(true)}>
          Ablesung erfassen
        </Button>
      </Group>

      <Tabs value={tab} onChange={(t) => navigate(`/meters/${m.id}/${t}`)} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="verlauf">Verlauf</Tabs.Tab>
          <Tabs.Tab value="ablesungen">Ablesungen</Tabs.Tab>
          <Tabs.Tab value="abrechnung">Abrechnung</Tabs.Tab>
          <Tabs.Tab value="tarife">Tarife & Abschläge</Tabs.Tab>
          <Tabs.Tab value="einstellungen">Einstellungen</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="verlauf" pt="md">
          <ChartTab meter={m} />
        </Tabs.Panel>
        <Tabs.Panel value="ablesungen" pt="md">
          <ReadingsTab meter={m} />
        </Tabs.Panel>
        <Tabs.Panel value="abrechnung" pt="md">
          <BillingTab meter={m} />
        </Tabs.Panel>
        <Tabs.Panel value="tarife" pt="md">
          <TariffsTab meter={m} />
        </Tabs.Panel>
        <Tabs.Panel value="einstellungen" pt="md">
          <SettingsTab meter={m} />
        </Tabs.Panel>
      </Tabs>

      <ReadingModal meter={m} opened={capture} onClose={() => setCapture(false)} />
    </Stack>
  );
}
