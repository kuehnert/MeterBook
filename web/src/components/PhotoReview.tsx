import { Alert, Badge, Button, Card, Center, Checkbox, Group, Image, Loader, Modal, Select, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconAlertTriangle, IconSparkles, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { blob, del, get, post } from '../lib/api';
import { num } from '../lib/format';
import { cropToBoxes, loadImage } from '../lib/image';
import type { Box, InboxItem, Meter, OcrResult, RegisterWarnings, UploadResult } from '../lib/types';
import { DateTimeField } from './DateFields';
import { DecimalInput } from './DecimalInput';
import { ICON_COLOR, MediumIcon, iconOf } from './MediumIcon';

const FORMAT = 'YYYY-MM-DD HH:mm:ss';

export const boxesOf = (ocr: OcrResult | null | undefined): Box[] =>
  (ocr?.registers ?? []).map((r) => r.box).filter((b): b is Box => !!b && b.length === 4);

/** Lädt ein Foto vom Server und liefert URL, Bild und – falls bekannt – den Ziffern-Ausschnitt. */
export function usePhoto(photoId: string | null, ocr: OcrResult | null | undefined, cropped: boolean) {
  const [state, setState] = useState<{ url: string; crop: string | null } | null>(null);
  useEffect(() => {
    if (!photoId) {
      setState(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    void (async () => {
      const data = await blob(`/photos/${photoId}`);
      url = URL.createObjectURL(data);
      const img = await loadImage(url);
      // Schon zugeschnittene Fotos zeigen wir ganz – sie sind ja der Ausschnitt.
      const crop = cropped ? null : cropToBoxes(img, boxesOf(ocr));
      if (!cancelled) setState({ url, crop });
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photoId, ocr, cropped]);
  return state;
}

/** Foto (bzw. Ausschnitt) mit Vollbild zum Vergrößern */
export function PhotoPreview({ url, crop }: { url: string; crop: string | null }) {
  const [zoom, setZoom] = useState(false);
  return (
    <>
      <Card withBorder p={0} onClick={() => setZoom(true)} style={{ cursor: 'zoom-in' }}>
        <Image src={crop ?? url} mah={crop ? 220 : 300} fit="contain" />
        <Text size="xs" c="dimmed" ta="center" py={4}>
          {crop ? 'Erkannte Ziffern – so wird das Foto gespeichert · antippen für das ganze Foto' : 'Antippen zum Vergrößern'}
        </Text>
      </Card>
      <Modal opened={zoom} onClose={() => setZoom(false)} fullScreen title="Foto" padding={0}>
        <Center p="xs">
          {/* Mit zwei Fingern zoomen ist im Browser eingebaut */}
          <img src={url} alt="Foto des Zählers" style={{ maxWidth: '100%', touchAction: 'pinch-zoom' }} />
        </Center>
      </Modal>
    </>
  );
}

interface Props {
  /** Foto aus dem Eingang; null = Ablesung ohne Foto */
  item: InboxItem | null;
  onSaved: (meterName: string) => void;
  onCancel: () => void;
  /** Foto wurde verworfen */
  onDiscarded?: () => void;
}

/**
 * Prüfen und Speichern einer Ablesung: Ziffern-Ausschnitt, Zähler (erkannt oder gewählt),
 * vorbefüllte Werte mit Sicherheit, Plausibilität, Zeitpunkt.
 */
export function PhotoReview({ item, onSaved, onCancel, onDiscarded }: Props) {
  const qc = useQueryClient();
  const meters = useQuery({ queryKey: ['meters'], queryFn: () => get<Meter[]>('/meters') });
  const [ocr, setOcr] = useState<OcrResult | null>(item?.ocr ?? null);
  const [ocrError, setOcrError] = useState<string | null>(item?.ocrError ?? null);
  const [meterId, setMeterId] = useState<string | null>(item?.meterId ?? null);
  const [autoAssigned, setAutoAssigned] = useState(!!item?.ocr?.meterId);
  const [values, setValues] = useState<Record<string, number | ''>>({});
  const [readAt, setReadAt] = useState(dayjs(item?.takenAt ?? undefined).format(FORMAT));
  const [note, setNote] = useState('');
  const [keepFull, setKeepFull] = useState(false);
  const [warnings, setWarnings] = useState<RegisterWarnings[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const photo = usePhoto(item?.photoId ?? null, ocr, item?.cropped ?? false);

  const meter = meters.data?.find((m) => m.id === meterId) ?? null;

  // Erkannte Werte immer vorbefüllen – korrigiert wird nur, was nicht stimmt
  useEffect(() => {
    const v: Record<string, number | ''> = {};
    for (const r of ocr?.registers ?? []) if (r.value !== null) v[r.registerId] = r.value;
    setValues(v);
  }, [ocr]);

  /** Anderer Zähler: das Foto wird für diesen Zähler neu gelesen. */
  const chooseMeter = async (id: string | null) => {
    if (!id || id === meterId) return;
    setMeterId(id);
    setAutoAssigned(false);
    setWarnings([]);
    if (!item) return;
    setBusy('assign');
    setError(null);
    try {
      const res = await post<UploadResult>(`/photos/${item.photoId}/assign`, { meterId: id });
      setOcr(res.ocr);
      setOcrError(res.ocrError);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(null);
    }
  };

  const payload = () => ({
    readAt: dayjs(readAt).toISOString(),
    photoId: item?.photoId,
    note: note || undefined,
    keepFullPhoto: keepFull || undefined,
    values: (meter?.registers ?? [])
      .filter((r) => values[r.id] !== '' && values[r.id] !== undefined)
      .map((r) => {
        const o = ocr?.registers.find((x) => x.registerId === r.id);
        return { registerId: r.id, value: Number(values[r.id]), ocrValue: o?.value ?? undefined, ocrConfidence: o?.confidence ?? undefined };
      }),
  });

  // Plausibilität prüfen, sobald Werte da sind
  useEffect(() => {
    if (!meter) return;
    const p = payload();
    if (p.values.length === 0) return;
    const h = setTimeout(() => {
      post<RegisterWarnings[]>(`/meters/${meter.id}/readings/check`, p).then(setWarnings).catch(() => {});
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, readAt, meterId]);

  const save = async () => {
    if (!meter) return setError('Bitte den Zähler wählen.');
    const p = payload();
    if (p.values.length === 0) return setError('Bitte den Zählerstand eingeben.');
    setBusy('save');
    setError(null);
    try {
      await post(`/meters/${meter.id}/readings`, p);
      await qc.invalidateQueries();
      onSaved(meter.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  };

  const discard = () =>
    modals.openConfirmModal({
      title: 'Foto verwerfen?',
      children: <Text size="sm">Das Foto wird gelöscht, es wird keine Ablesung gespeichert.</Text>,
      labels: { confirm: 'Verwerfen', cancel: 'Abbrechen' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        if (!item) return;
        await del(`/photos/${item.photoId}`);
        await qc.invalidateQueries({ queryKey: ['inbox'] });
        onDiscarded?.();
      },
    });

  const ocrFor = (id: string) => ocr?.registers.find((r) => r.registerId === id);
  const canCrop = !!photo?.crop;

  return (
    <Stack gap="md">
      {item && (photo ? <PhotoPreview url={photo.url} crop={keepFull ? null : photo.crop} /> : <Center h={160}><Loader /></Center>)}

      <Select
        label={autoAssigned ? 'Zähler (automatisch erkannt)' : 'Zähler'}
        placeholder="Bitte wählen"
        data={(meters.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
        value={meterId}
        onChange={(v) => void chooseMeter(v)}
        allowDeselect={false}
        size="md"
        disabled={busy === 'assign'}
        leftSection={
          meter ? (
            <ThemeIcon variant="light" size="sm" color={ICON_COLOR[iconOf(meter)]}>
              <MediumIcon meter={meter} size={14} />
            </ThemeIcon>
          ) : undefined
        }
      />
      {busy === 'assign' && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm">Stand wird für diesen Zähler gelesen …</Text>
        </Group>
      )}
      {item && !meterId && (
        <Alert color="orange" icon={<IconAlertTriangle size={16} />}>
          Der Zähler wurde nicht erkannt – bitte oben auswählen.
        </Alert>
      )}
      {ocr && meter && (
        <Badge leftSection={<IconSparkles size={12} />} variant="light" size="lg">
          Automatisch erkannt – bitte prüfen
        </Badge>
      )}
      {ocr?.serialNumberMatches === false && (
        <Alert color="orange">
          Auf dem Foto steht die Zählernummer {ocr.serialNumberSeen}, erwartet wird {meter?.serialNumber}. Richtiger Zähler?
        </Alert>
      )}
      {ocrError && <Alert color="orange">Erkennung nicht möglich: {ocrError}</Alert>}

      {meter?.registers.map((r) => {
        const o = ocrFor(r.id);
        const w = warnings.find((x) => x.registerId === r.id)?.warnings ?? [];
        return (
          <Stack key={r.id} gap={4}>
            <DecimalInput
              label={meter.registers.length > 1 ? `Zählwerk ${r.name}` : 'Zählerstand'}
              description={r.lastReading ? `Zuletzt ${num(r.lastReading.value, r.decimals)} ${meter.unit}` : undefined}
              value={values[r.id] ?? ''}
              onChange={(v) => setValues((s) => ({ ...s, [r.id]: v === '' ? '' : Number(v) }))}
              decimalScale={r.decimals}
              min={0}
              hideControls
              size="lg"
              inputMode="decimal"
              rightSection={
                <Text size="sm" c="dimmed" pr="xs">
                  {meter.unit}
                </Text>
              }
              rightSectionWidth={54}
              classNames={{ input: 'tabular' }}
            />
            {o && (
              <Text size="xs" c={o.confidence < 0.6 ? 'yellow.8' : 'dimmed'}>
                erkannt „{o.digits}“ · Sicherheit {Math.round(o.confidence * 100)} %
                {o.confidence < 0.6 ? ' – bitte Ziffern mit dem Foto vergleichen' : ''}
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

      {meter && (
        <>
          <DateTimeField label="Zeitpunkt" value={readAt} onChange={setReadAt} />
          <TextInput label="Notiz" placeholder="optional" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
          {canCrop && (
            <Checkbox
              label="Ganzes Foto behalten"
              description="Sonst wird nur der Ausschnitt mit den Ziffern gespeichert."
              checked={keepFull}
              onChange={(e) => setKeepFull(e.currentTarget.checked)}
            />
          )}
        </>
      )}
      {error && <Alert color="red">{error}</Alert>}

      <Group grow>
        <Button variant="default" onClick={onCancel}>
          {item ? 'Später' : 'Abbrechen'}
        </Button>
        <Button size="md" onClick={() => void save()} loading={busy === 'save'} disabled={!meter || busy === 'assign'}>
          {warnings.some((w) => w.warnings.length > 0) ? 'Trotzdem speichern' : 'Speichern'}
        </Button>
      </Group>
      {item && (
        <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={discard}>
          Foto verwerfen
        </Button>
      )}
    </Stack>
  );
}
