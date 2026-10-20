import {
  Alert,
  Badge,
  Button,
  Group,
  Image,
  Loader,
  Modal,
  NumberInput,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCamera, IconSparkles } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api';
import { num } from '../lib/format';
import type { Health, Meter, ReadingGroup, RegisterWarnings, UploadResult } from '../lib/types';
import { AuthImage } from './AuthImage';

interface Props {
  meter: Meter;
  opened: boolean;
  onClose: () => void;
  /** Bestehende Ablesung bearbeiten */
  edit?: ReadingGroup | null;
}

const FORMAT = 'YYYY-MM-DD HH:mm:ss';

export function ReadingModal({ meter, opened, onClose, edit }: Props) {
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: () => get<Health>('/health'), staleTime: Infinity });
  const [readAt, setReadAt] = useState<string>(dayjs().format(FORMAT));
  const [values, setValues] = useState<Record<string, number | ''>>({});
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ id: string; preview?: string } | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [warnings, setWarnings] = useState<RegisterWarnings[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setReadAt(dayjs(edit?.readAt ?? undefined).format(FORMAT));
    setValues(Object.fromEntries(meter.registers.map((r) => [r.id, edit?.values[r.id]?.value ?? ''])));
    setNote(edit?.note ?? '');
    setPhoto(edit?.photoId ? { id: edit.photoId } : null);
    setUpload(null);
    setWarnings([]);
    setError(null);
  }, [opened, edit, meter]);

  const payload = useMemo(
    () => ({
      readAt: dayjs(readAt).toISOString(),
      originalReadAt: edit?.readAt,
      photoId: photo?.id,
      note: note || undefined,
      values: meter.registers
        .filter((r) => values[r.id] !== '' && values[r.id] !== undefined)
        .map((r) => {
          const ocr = upload?.ocr?.registers.find((x) => x.registerId === r.id);
          const prev = edit?.values[r.id];
          return {
            registerId: r.id,
            value: Number(values[r.id]),
            ocrValue: ocr?.value ?? prev?.ocrValue ?? undefined,
            ocrConfidence: ocr?.confidence ?? prev?.ocrConfidence ?? undefined,
          };
        }),
    }),
    [readAt, edit, photo, note, values, meter, upload],
  );

  // Plausibilität live prüfen, sobald Werte vollständig sind.
  useEffect(() => {
    if (!opened || payload.values.length === 0) {
      setWarnings([]);
      return;
    }
    const h = setTimeout(() => {
      post<RegisterWarnings[]>(`/meters/${meter.id}/readings/check`, payload)
        .then(setWarnings)
        .catch(() => setWarnings([]));
    }, 400);
    return () => clearTimeout(h);
  }, [payload, opened, meter.id]);

  const onDrop = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const preview = URL.createObjectURL(file);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // Aufnahmezeitpunkt: bei neuen Ablesungen der gewählte Zeitpunkt
      fd.append('takenAt', dayjs(readAt).toISOString());
      const res = await post<UploadResult>(`/meters/${meter.id}/photos`, fd);
      setPhoto({ id: res.photoId, preview });
      setUpload(res);
      if (res.ocr) {
        setValues((v) => {
          const next = { ...v };
          for (const r of res.ocr!.registers) if (r.value !== null) next[r.registerId] = r.value;
          return next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (payload.values.length === 0) {
      setError('Bitte mindestens einen Zählerstand eingeben.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await post(`/meters/${meter.id}/readings`, payload);
      notifications.show({ color: 'green', message: 'Ablesung gespeichert' });
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const ocrFor = (id: string) => upload?.ocr?.registers.find((r) => r.registerId === id);
  const warningsFor = (id: string) => warnings.find((w) => w.registerId === id)?.warnings ?? [];

  return (
    <Modal opened={opened} onClose={onClose} title={`${edit ? 'Ablesung bearbeiten' : 'Ablesung erfassen'} – ${meter.name}`} size="lg">
      <Stack>
        {photo ? (
          <Stack gap="xs">
            {photo.preview ? (
              <Image src={photo.preview} radius="md" mah={260} fit="contain" />
            ) : (
              <AuthImage photoId={photo.id} mah={260} />
            )}
            <Group justify="space-between">
              {upload?.ocr ? (
                <Badge leftSection={<IconSparkles size={12} />} variant="light">
                  Automatisch erkannt – bitte prüfen
                </Badge>
              ) : (
                <span />
              )}
              <Button variant="subtle" size="xs" onClick={() => { setPhoto(null); setUpload(null); }}>
                Foto entfernen
              </Button>
            </Group>
          </Stack>
        ) : (
          <Dropzone onDrop={onDrop} accept={IMAGE_MIME_TYPE} maxFiles={1} loading={uploading} maxSize={25 * 1024 * 1024}>
            <Group justify="center" gap="sm" mih={90} style={{ pointerEvents: 'none' }}>
              <IconCamera size={32} stroke={1.5} />
              <div>
                <Text size="sm" fw={500}>
                  Foto vom Zähler hierher ziehen oder klicken
                </Text>
                <Text size="xs" c="dimmed">
                  {health.data?.ocr ? 'Der Stand wird automatisch erkannt.' : 'Das Foto wird als Beleg gespeichert.'}
                </Text>
              </div>
            </Group>
          </Dropzone>
        )}
        {uploading && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Foto wird hochgeladen und ausgewertet …
            </Text>
          </Group>
        )}
        {upload?.ocrError && <Alert color="orange">Automatische Erkennung fehlgeschlagen: {upload.ocrError}</Alert>}
        {upload?.ocr?.serialNumberMatches === false && (
          <Alert color="orange" icon={<IconAlertTriangle size={16} />}>
            Auf dem Foto steht die Zählernummer {upload.ocr.serialNumberSeen}, erwartet wird {meter.serialNumber}. Ist das der richtige Zähler?
          </Alert>
        )}
        {upload?.ocr && upload.ocr.issues.length > 0 && (
          <Alert color="gray" variant="light">
            {upload.ocr.issues.join(' · ')}
          </Alert>
        )}

        <DateTimePicker
          label="Zeitpunkt der Ablesung"
          value={readAt}
          onChange={(v) => v && setReadAt(dayjs(v).format(FORMAT))}
          valueFormat="DD.MM.YYYY HH:mm"
          maxDate={dayjs().format(FORMAT)}
        />

        {meter.registers.map((r) => {
          const ocr = ocrFor(r.id);
          const w = warningsFor(r.id);
          return (
            <Stack key={r.id} gap={4}>
              <NumberInput
                label={
                  <Group gap={6} component="span">
                    <span>{meter.registers.length > 1 ? `Zählwerk ${r.name}` : 'Zählerstand'}</span>
                    {ocr && (
                      <Badge size="xs" variant="light" color={ocr.confidence >= 0.85 ? 'green' : ocr.confidence >= 0.6 ? 'yellow' : 'red'}>
                        erkannt {ocr.digits || '–'} · {Math.round(ocr.confidence * 100)} %
                      </Badge>
                    )}
                  </Group>
                }
                description={r.lastReading ? `Zuletzt ${num(r.lastReading.value, r.decimals)} ${meter.unit}` : undefined}
                value={values[r.id] ?? ''}
                onChange={(v) => setValues((s) => ({ ...s, [r.id]: v === '' ? '' : Number(v) }))}
                decimalSeparator=","
                thousandSeparator="."
                decimalScale={r.decimals}
                min={0}
                hideControls
                rightSection={<Text size="sm" c="dimmed" pr="xs">{meter.unit}</Text>}
                rightSectionWidth={50}
                error={w.length > 0 ? undefined : null}
                classNames={{ input: 'tabular' }}
              />
              {ocr && ocr.confidence < 0.6 && (
                <Text size="xs" c="yellow.8">
                  Unsicher erkannt – bitte die Ziffern {ocr.digits.includes('[') ? 'in eckigen Klammern ' : ''}mit dem Foto vergleichen.
                </Text>
              )}
              {w.map((x, i) => (
                <Text key={i} size="xs" c="orange.7">
                  {x.message}
                </Text>
              ))}
            </Stack>
          );
        })}

        <TextInput label="Notiz" placeholder="optional" value={note} onChange={(e) => setNote(e.currentTarget.value)} />

        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Abbrechen
          </Button>
          <Button onClick={save} loading={saving} disabled={uploading}>
            {warnings.some((w) => w.warnings.length > 0) ? 'Trotzdem speichern' : 'Speichern'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
