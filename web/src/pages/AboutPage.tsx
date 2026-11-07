import { Anchor, Card, Divider, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconGauge } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import type { Health } from '../lib/types';

/** Projektseite von MeterBook (Teil von kuehnert.online) */
export const PROJECT_URL = 'https://kuehnert.online';

/** Über MeterBook: Version, wer es gebaut hat, Link zur Projektseite. */
export function AboutPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => get<Health>('/health'), staleTime: Infinity });
  return (
    <Stack maw={560}>
      <Title order={2}>Über MeterBook</Title>
      <Card withBorder padding="xl">
        <Stack align="center" gap="sm" ta="center">
          <ThemeIcon size={72} radius="xl">
            <IconGauge size={44} />
          </ThemeIcon>
          <Title order={3}>MeterBook</Title>
          <Text size="sm" c="dimmed">
            Version {health.data?.version ?? '–'}
          </Text>
          <Text>
            Zählerstände fotografieren und ablesen – Strom, Wasser, Gas und Wärme. Verbrauch, Kosten und Prognosen immer im Blick,
            im Browser und in der Android-App.
          </Text>
          <Divider w="100%" my="xs" />
          <Text size="sm" c="dimmed">
            Gebaut von
          </Text>
          <Text fw={600} size="lg">
            Matthias Kühnert und Claude
          </Text>
          <Text size="xs" c="dimmed">
            Claude ist eine KI von Anthropic.
          </Text>
          <Divider w="100%" my="xs" />
          <Text size="sm" c="dimmed">
            Mehr über MeterBook
          </Text>
          <Anchor href={PROJECT_URL} target="_blank" rel="noopener" fw={600}>
            {PROJECT_URL.replace('https://', '')}
          </Anchor>
        </Stack>
      </Card>
    </Stack>
  );
}
