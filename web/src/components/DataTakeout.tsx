import { Alert, Button, Card, FileInput, Group, List, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDatabaseExport, IconDatabaseImport } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { download, post } from '../lib/api';

export interface ImportSummary {
  metersCreated: number;
  metersMerged: number;
  registersCreated: number;
  readingsCreated: number;
  readingsUpdated: number;
  photosCreated: number;
  exchangesCreated: number;
  tariffsCreated: number;
  advancesCreated: number;
}

export function summaryLines(s: ImportSummary): string[] {
  return [
    s.metersCreated && `${s.metersCreated} Zähler neu`,
    s.metersMerged && `${s.metersMerged} Zähler ergänzt`,
    s.readingsCreated && `${s.readingsCreated} Ablesungen neu`,
    s.readingsUpdated && `${s.readingsUpdated} Ablesungen aktualisiert`,
    s.photosCreated && `${s.photosCreated} Fotos`,
    s.tariffsCreated && `${s.tariffsCreated} Tarife`,
    s.advancesCreated && `${s.advancesCreated} Abschläge`,
    s.exchangesCreated && `${s.exchangesCreated} Gerätewechsel`,
  ].filter((x): x is string => !!x);
}

/** Eigene Daten als Datei herunterladen und wieder einlesen. */
export function DataTakeout() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(null);
    }
  };

  const send = (dryRun: boolean) =>
    run(dryRun ? 'check' : 'import', async () => {
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      const res = await post<ImportSummary>(`/me/import?dryRun=${dryRun}`, fd);
      if (dryRun) {
        setPreview(res);
      } else {
        await qc.invalidateQueries();
        notifications.show({ color: 'green', message: `Eingelesen: ${summaryLines(res).join(', ') || 'nichts Neues'}` });
        setFile(null);
        setPreview(null);
      }
    });

  return (
    <Card withBorder>
      <Stack>
        <div>
          <Title order={4}>Meine Daten</Title>
          <Text size="sm" c="dimmed">
            Alle Zähler, Ablesungen (mit Fotos), Tarife und Abschläge in einer Datei – zum Aufbewahren oder um sie auf einem anderen
            MeterBook-Server wieder einzulesen.
          </Text>
        </div>
        <Group>
          <Button
            leftSection={<IconDatabaseExport size={16} />}
            variant="default"
            loading={busy === 'export'}
            onClick={() => void run('export', () => download('/me/export', 'MeterBook-Daten.zip'))}
          >
            Daten herunterladen
          </Button>
        </Group>
        <Text size="sm" fw={500}>
          Daten einlesen
        </Text>
        <Text size="xs" c="dimmed">
          Vorhandenes wird nur ergänzt, nie gelöscht: Zähler mit gleichem Namen werden zusammengeführt, Ablesungen zum selben Zeitpunkt
          nicht doppelt angelegt.
        </Text>
        <Group align="flex-end">
          <FileInput
            placeholder="MeterBook-Daten….zip"
            accept=".zip,.json"
            value={file}
            onChange={(f) => {
              setFile(f);
              setPreview(null);
            }}
            clearable
            w={300}
          />
          <Button variant="default" disabled={!file} loading={busy === 'check'} onClick={() => void send(true)}>
            Prüfen
          </Button>
          <Button leftSection={<IconDatabaseImport size={16} />} disabled={!preview} loading={busy === 'import'} onClick={() => void send(false)}>
            Einlesen
          </Button>
        </Group>
        {preview && (
          <Alert color="blue" title="Das würde eingelesen">
            {summaryLines(preview).length ? (
              <List size="sm">
                {summaryLines(preview).map((l) => (
                  <List.Item key={l}>{l}</List.Item>
                ))}
              </List>
            ) : (
              <Text size="sm">Nichts Neues – alles ist schon vorhanden.</Text>
            )}
          </Alert>
        )}
        {error && <Alert color="red">{error}</Alert>}
      </Stack>
    </Card>
  );
}
