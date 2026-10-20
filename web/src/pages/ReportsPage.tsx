import { Alert, Button, Card, FileInput, Group, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFileSpreadsheet, IconFileTypePdf, IconUpload } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { download, post } from '../lib/api';
import { dateTime, num } from '../lib/format';

interface ImportPreview {
  imported: number;
  readings: Array<{ meterName: string; readAt: string; values: Array<{ registerName: string; value: number }> }>;
  errors: Array<{ line: number; message: string }>;
}

export function ReportsPage() {
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear - 1));
  const [busy, setBusy] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

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

  const sendImport = (dryRun: boolean) =>
    run(dryRun ? 'check' : 'import', async () => {
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      const res = await post<ImportPreview>(`/import/readings?dryRun=${dryRun}`, fd);
      setPreview(res);
      if (!dryRun && res.imported > 0) {
        await qc.invalidateQueries();
        notifications.show({ color: 'green', message: `${res.imported} Ablesungen importiert` });
        setFile(null);
        setPreview(null);
      }
    });

  return (
    <Stack maw={900}>
      <Title order={2}>Berichte & Export</Title>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Card withBorder>
          <Stack>
            <Group gap="xs">
              <IconFileTypePdf size={22} />
              <Title order={4}>Jahresbericht (PDF)</Title>
            </Group>
            <Text size="sm" c="dimmed">
              Je Zähler die Abrechnungsperiode, die im gewählten Jahr beginnt – beim Heizstrom mit Stichtag Juli also Juli bis Juni. Mit Kosten, Abschlägen, Monatsverlauf und Ablesungen.
            </Text>
            <Select
              label="Jahr"
              data={Array.from({ length: 10 }, (_, i) => String(thisYear - i))}
              value={year}
              onChange={(v) => v && setYear(v)}
              allowDeselect={false}
              w={140}
            />
            <Button loading={busy === 'pdf'} onClick={() => run('pdf', () => download(`/reports/annual.pdf?year=${year}`, `MeterBook-Bericht-${year}.pdf`))}>
              PDF erstellen
            </Button>
          </Stack>
        </Card>
        <Card withBorder>
          <Stack>
            <Group gap="xs">
              <IconFileSpreadsheet size={22} />
              <Title order={4}>Excel-Export</Title>
            </Group>
            <Text size="sm" c="dimmed">
              Alle Ablesungen, der Monatsverbrauch und die Abrechnungsperioden aller aktiven Zähler als Excel-Datei – mit Filtern, gut für eigene Auswertungen.
            </Text>
            <Button variant="default" loading={busy === 'xlsx'} onClick={() => run('xlsx', () => download('/export/xlsx', 'MeterBook.xlsx'))} mt="auto">
              Excel herunterladen
            </Button>
          </Stack>
        </Card>
      </SimpleGrid>

      <Card withBorder>
        <Stack>
          <Group gap="xs">
            <IconUpload size={22} />
            <Title order={4}>Alte Ablesungen importieren</Title>
          </Group>
          <Text size="sm" c="dimmed">
            CSV (Semikolon) oder Excel mit den Spalten <b>Datum</b>, <b>Zähler</b>, <b>Zählwerk</b>, <b>Stand</b> und optional <b>Notiz</b>. Zähler werden über ihren Namen oder die Zählernummer zugeordnet; das Zählwerk über Bezeichnung oder Kürzel (HT, NT). Bei Zählern mit nur einem Zählwerk kann die Spalte leer bleiben.
          </Text>
          <Group>
            <Button variant="subtle" size="xs" onClick={() => void download('/import/template.csv', 'MeterBook-Importvorlage.csv')}>
              Vorlage herunterladen
            </Button>
          </Group>
          <Group align="flex-end">
            <FileInput
              label="Datei"
              placeholder="CSV oder XLSX wählen"
              accept=".csv,.txt,.xlsx"
              value={file}
              onChange={(f) => {
                setFile(f);
                setPreview(null);
              }}
              clearable
              w={320}
            />
            <Button variant="default" disabled={!file} loading={busy === 'check'} onClick={() => void sendImport(true)}>
              Prüfen
            </Button>
            <Button disabled={!file || !preview || preview.errors.length > 0 || preview.readings.length === 0} loading={busy === 'import'} onClick={() => void sendImport(false)}>
              Importieren
            </Button>
          </Group>

          {preview && preview.errors.length > 0 && (
            <Alert color="red" title="Die Datei enthält Fehler – es wurde nichts importiert">
              {preview.errors.slice(0, 15).map((e) => (
                <Text key={e.line} size="sm">
                  Zeile {e.line}: {e.message}
                </Text>
              ))}
              {preview.errors.length > 15 && <Text size="sm">… und {preview.errors.length - 15} weitere</Text>}
            </Alert>
          )}
          {preview && preview.errors.length === 0 && (
            <>
              <Text size="sm">
                {preview.readings.length} Ablesungen erkannt. Bereits vorhandene Werte zum selben Zeitpunkt werden überschrieben.
              </Text>
              <Table.ScrollContainer minWidth={400} mah={300}>
                <Table striped>
                  <Table.Tbody>
                    {preview.readings.map((r, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>{dateTime(r.readAt)}</Table.Td>
                        <Table.Td>{r.meterName}</Table.Td>
                        <Table.Td className="tabular">{r.values.map((v) => `${v.registerName}: ${num(v.value, 2)}`).join(' · ')}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
