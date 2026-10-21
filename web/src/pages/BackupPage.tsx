import { ActionIcon, Alert, Badge, Button, Card, Code, FileInput, Group, List, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconPhotoOff, IconRestore, IconShieldCheck, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { blob, del, download, get, logout, post } from '../lib/api';
import { dateTime } from '../lib/format';

interface BackupEntry {
  name: string;
  size: number;
  createdAt: string;
  kind: string;
}

interface BackupStatus {
  backups: BackupEntry[];
  dir: string;
  intervalHours: number;
  keep: number;
  tokenConfigured: boolean;
  photos: { retentionDays: number; total: number; expiring: number };
}

interface Inspection {
  createdAt: string;
  photos: number;
  users: Array<{ email: string; name: string; role: string; meters: number; readings: number }>;
}

const KIND: Record<string, { label: string; color: string }> = {
  auto: { label: 'automatisch', color: 'gray' },
  manuell: { label: 'manuell', color: 'blue' },
  skript: { label: 'Skript', color: 'grape' },
  'vor-wiederherstellung': { label: 'vor Wiederherstellung', color: 'orange' },
};

const mb = (n: number) => `${(n / 1_048_576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;

/** Server-Sicherung für Administratoren */
export function BackupPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['backups'], queryFn: () => get<BackupStatus>('/admin/backups') });
  const [busy, setBusy] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const s = q.data;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Fehler' });
    } finally {
      setBusy(null);
    }
  };

  /** Rückfrage mit Inhalt der Sicherung, dann einspielen und neu anmelden. */
  const confirmRestore = (info: Inspection, label: string, restore: () => Promise<unknown>) =>
    modals.openConfirmModal({
      title: 'Alle Daten ersetzen?',
      size: 'lg',
      children: (
        <Stack gap="xs">
          <Text size="sm">
            {label} vom {dateTime(info.createdAt)} ersetzt <b>alle Daten aller Nutzer</b> auf diesem Server. Der aktuelle Stand wird vorher
            automatisch gesichert („vor Wiederherstellung“).
          </Text>
          <List size="sm">
            {info.users.map((u) => (
              <List.Item key={u.email}>
                {u.name} ({u.email}{u.role === 'ADMIN' ? ', Administrator' : ''}): {u.meters} Zähler, {u.readings} Ablesungen
              </List.Item>
            ))}
          </List>
          <Text size="sm">{info.photos} Fotos. Danach müssen sich alle neu anmelden.</Text>
        </Stack>
      ),
      labels: { confirm: 'Alle Daten ersetzen', cancel: 'Abbrechen' },
      confirmProps: { color: 'red' },
      onConfirm: () =>
        void run('restore', async () => {
          await restore();
          notifications.show({ color: 'green', message: 'Sicherung eingespielt – bitte neu anmelden' });
          await logout();
        }),
    });

  const restoreStored = (b: BackupEntry) =>
    run(`inspect-${b.name}`, async () => {
      const data = await blob(`/admin/backups/${encodeURIComponent(b.name)}`);
      const fd = new FormData();
      fd.append('file', new File([data], b.name));
      const info = await post<Inspection>('/admin/restore?dryRun=true', fd);
      confirmRestore(info, 'Die Sicherung', () => post(`/admin/backups/${encodeURIComponent(b.name)}/restore`));
    });

  const restoreUpload = () =>
    run('inspect-upload', async () => {
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      const info = await post<Inspection>('/admin/restore?dryRun=true', fd);
      confirmRestore(info, `„${file.name}“`, () => {
        const fd2 = new FormData();
        fd2.append('file', file);
        return post('/admin/restore', fd2);
      });
    });

  return (
    <Stack maw={900}>
      <Title order={2}>Sicherung</Title>

      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <div>
            <Title order={4}>Server-Sicherungen</Title>
            <Text size="sm" c="dimmed">
              Enthalten alle Nutzer mit Passwörtern, Zählern, Ablesungen, Tarifen und Fotos.
              {s && s.intervalHours > 0
                ? ` Automatisch alle ${s.intervalHours} Stunden, die letzten ${s.keep} automatischen bleiben erhalten.`
                : ' Automatische Sicherung ist aus (BACKUP_INTERVAL_HOURS=0).'}
            </Text>
          </div>
          <Button
            leftSection={<IconShieldCheck size={16} />}
            loading={busy === 'create'}
            onClick={() =>
              void run('create', async () => {
                await post('/admin/backups');
                await qc.invalidateQueries({ queryKey: ['backups'] });
                notifications.show({ color: 'green', message: 'Sicherung angelegt' });
              })
            }
          >
            Jetzt sichern
          </Button>
        </Group>
        <Table.ScrollContainer minWidth={520}>
          <Table>
            <Table.Tbody>
              {(s?.backups ?? []).map((b) => (
                <Table.Tr key={b.name}>
                  <Table.Td>
                    <Text size="sm">{dateTime(b.createdAt)}</Text>
                    <Text size="xs" c="dimmed">
                      {b.name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={KIND[b.kind]?.color ?? 'gray'}>
                      {KIND[b.kind]?.label ?? b.kind}
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right" className="tabular">
                    {mb(b.size)}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={2} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Herunterladen">
                        <ActionIcon variant="subtle" aria-label="Herunterladen" onClick={() => void download(`/admin/backups/${encodeURIComponent(b.name)}`, b.name)}>
                          <IconDownload size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Wiederherstellen">
                        <ActionIcon variant="subtle" color="orange" aria-label="Wiederherstellen" loading={busy === `inspect-${b.name}`} onClick={() => void restoreStored(b)}>
                          <IconRestore size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Löschen">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label="Löschen"
                          onClick={() =>
                            modals.openConfirmModal({
                              title: 'Sicherung löschen?',
                              children: <Text size="sm">{b.name}</Text>,
                              labels: { confirm: 'Löschen', cancel: 'Abbrechen' },
                              confirmProps: { color: 'red' },
                              onConfirm: () =>
                                void run('delete', async () => {
                                  await del(`/admin/backups/${encodeURIComponent(b.name)}`);
                                  await qc.invalidateQueries({ queryKey: ['backups'] });
                                }),
                            })
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {s?.backups.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" p="md">
            Noch keine Sicherung vorhanden.
          </Text>
        )}
        {s && (
          <Text size="xs" c="dimmed" mt="sm">
            Ablageort im Container: <Code>{s.dir}</Code>. Kopiere Sicherungen regelmäßig auch auf ein anderes Gerät – eine Sicherung auf
            derselben Platte hilft nicht, wenn die Platte ausfällt.
          </Text>
        )}
      </Card>

      <Card withBorder>
        <Stack>
          <div>
            <Title order={4}>Aus Datei wiederherstellen</Title>
            <Text size="sm" c="dimmed">
              Z. B. nach einer Neuinstallation: eine heruntergeladene Server-Sicherung einspielen. Du siehst vorher, was darin enthalten ist.
            </Text>
          </div>
          <Group align="flex-end">
            <FileInput placeholder="meterbook-….zip" accept=".zip,.json" value={file} onChange={setFile} clearable w={300} />
            <Button color="orange" variant="light" leftSection={<IconRestore size={16} />} disabled={!file} loading={busy === 'inspect-upload'} onClick={() => void restoreUpload()}>
              Prüfen und wiederherstellen
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder>
        <Group justify="space-between">
          <div>
            <Title order={4}>Fotos</Title>
            <Text size="sm" c="dimmed">
              {s
                ? s.photos.retentionDays > 0
                  ? `Fotos werden nach ${s.photos.retentionDays} Tagen gelöscht, die Ablesungen bleiben. ${s.photos.total} Fotos gespeichert, ${s.photos.expiring} davon sind älter.`
                  : `Fotos werden nie gelöscht (PHOTO_RETENTION_DAYS=0). ${s.photos.total} Fotos gespeichert.`
                : ''}
            </Text>
          </div>
          <Button
            variant="default"
            leftSection={<IconPhotoOff size={16} />}
            disabled={!s || s.photos.retentionDays <= 0}
            loading={busy === 'cleanup'}
            onClick={() =>
              void run('cleanup', async () => {
                const r = await post<{ deleted: number }>('/admin/photos/cleanup');
                await qc.invalidateQueries({ queryKey: ['backups'] });
                notifications.show({ message: `${r.deleted} Fotos gelöscht` });
              })
            }
          >
            Jetzt aufräumen
          </Button>
        </Group>
      </Card>

      <Card withBorder>
        <Title order={4} mb="xs">
          Sicherung per Skript
        </Title>
        {s?.tokenConfigured ? (
          <Stack gap="xs">
            <Text size="sm">Mit dem BACKUP_TOKEN aus der Server-Konfiguration lädt ein Skript die Sicherung herunter, z. B. per Aufgabenplanung:</Text>
            <Code block>{`curl -fsS -H "Authorization: Bearer <BACKUP_TOKEN>" ${location.origin}/api/backup -o meterbook-$(date +%F).zip`}</Code>
          </Stack>
        ) : (
          <Alert color="gray" variant="light">
            Dafür in der Server-Konfiguration <Code>BACKUP_TOKEN</Code> setzen (z. B. <Code>openssl rand -hex 32</Code>). Alternativ direkt
            im Container: <Code>docker exec meterbook node dist/cli.js backup</Code>
          </Alert>
        )}
      </Card>
    </Stack>
  );
}
