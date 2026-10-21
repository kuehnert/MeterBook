import { Alert, Badge, Button, Card, Center, Group, Image, Loader, Modal, Select, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { IconAlertTriangle, IconCamera, IconCheck, IconKeyboard, IconPhoto, IconSparkles } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { DateTimeField } from '../components/DateFields';
import { DecimalInput } from '../components/DecimalInput';
import { ICON_COLOR, MediumIcon, iconOf } from '../components/MediumIcon';
import { get, post } from '../lib/api';
import { num } from '../lib/format';
import { PreparedImage, cropToBoxes, prepareImage } from '../lib/image';
import type { Box, Meter, RegisterWarnings, UploadResult } from '../lib/types';

const FORMAT = 'YYYY-MM-DD HH:mm:ss';

type Step = 'start' | 'working' | 'review' | 'done';

/**
 * Ablesen auf dem Handy: Foto machen → der Server erkennt Zähler und Stand → prüfen → speichern.
 * Gedacht für die Web-App auf dem Home-Bildschirm (z. B. iPhone).
 */
export function CapturePage() {
  const qc = useQueryClient();
  const meters = useQuery({ queryKey: ['meters'], queryFn: () => get<Meter[]>('/meters') });
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('start');
  const [status, setStatus] = useState('');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [crop, setCrop] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [meterId, setMeterId] = useState<string | null>(null);
  const [autoAssigned, setAutoAssigned] = useState(false);
  const [values, setValues] = useState<Record<string, number | ''>>({});
  const [readAt, setReadAt] = useState(dayjs().format(FORMAT));
  const [note, setNote] = useState('');
  const [warnings, setWarnings] = useState<RegisterWarnings[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [savedName, setSavedName] = useState('');

  const meter = meters.data?.find((m) => m.id === meterId) ?? null;

  useEffect(() => () => {
    if (image) URL.revokeObjectURL(image.url);
  }, [image]);

  const reset = () => {
    setStep('start');
    setImage(null);
    setCrop(null);
    setUpload(null);
    setMeterId(null);
    setAutoAssigned(false);
    setValues({});
    setReadAt(dayjs().format(FORMAT));
    setNote('');
    setWarnings([]);
    setError(null);
  };

  /** Ergebnis der Erkennung übernehmen: Zähler, Werte (immer vorbefüllt), Ausschnitt. */
  const apply = (res: UploadResult, img: PreparedImage | null, auto: boolean) => {
    setUpload(res);
    setMeterId(res.meterId);
    setAutoAssigned(auto && !!res.meterId);
    setReadAt(dayjs(res.takenAt).format(FORMAT));
    const v: Record<string, number | ''> = {};
    for (const r of res.ocr?.registers ?? []) if (r.value !== null) v[r.registerId] = r.value;
    setValues(v);
    setWarnings(res.warnings);
    const boxes = (res.ocr?.registers ?? []).map((r) => r.box).filter((b): b is Box => !!b && b.length === 4);
    setCrop(img ? cropToBoxes(img.image, boxes) : null);
    setStep('review');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setStep('working');
    let img: PreparedImage | null = null;
    try {
      setStatus('Foto wird vorbereitet …');
      img = await prepareImage(file);
      setImage(img);
      setStatus('Zähler und Stand werden erkannt …');
      const fd = new FormData();
      fd.append('file', img.blob, 'foto.jpg');
      // Aufnahmezeitpunkt: bei einem Foto aus der Mediathek das Dateidatum, sonst jetzt
      fd.append('takenAt', new Date(file.lastModified || Date.now()).toISOString());
      const res = await post<UploadResult>('/photos', fd);
      apply(res, img, true);
    } catch (e) {
      // Foto behalten: Zähler von Hand wählen, dann wird es für diesen Zähler hochgeladen
      setError(`${e instanceof Error ? e.message : 'Hochladen fehlgeschlagen'}${img ? ' – bitte den Zähler wählen.' : ''}`);
      setStep(img ? 'review' : 'start');
    }
  };

  /** Anderer Zähler: das Foto wird für diesen Zähler neu gelesen. */
  const chooseMeter = async (id: string | null) => {
    if (!id || id === meterId) return;
    setMeterId(id);
    setAutoAssigned(false);
    setValues({});
    setWarnings([]);
    if (!upload && !image) return;
    setStep('working');
    setStatus('Stand wird für diesen Zähler gelesen …');
    setError(null);
    try {
      let res: UploadResult;
      if (upload) {
        res = await post<UploadResult>(`/photos/${upload.photoId}/assign`, { meterId: id });
      } else {
        const fd = new FormData();
        fd.append('file', image!.blob, 'foto.jpg');
        fd.append('takenAt', dayjs(readAt).toISOString());
        res = await post<UploadResult>(`/meters/${id}/photos`, fd);
      }
      apply({ ...res, meterId: res.meterId ?? id }, image, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
      setStep('review');
    }
  };

  const payload = () => ({
    readAt: dayjs(readAt).toISOString(),
    photoId: upload?.photoId,
    note: note || undefined,
    values: (meter?.registers ?? [])
      .filter((r) => values[r.id] !== '' && values[r.id] !== undefined)
      .map((r) => {
        const ocr = upload?.ocr?.registers.find((x) => x.registerId === r.id);
        return { registerId: r.id, value: Number(values[r.id]), ocrValue: ocr?.value ?? undefined, ocrConfidence: ocr?.confidence ?? undefined };
      }),
  });

  // Plausibilität prüfen, sobald Werte da sind
  useEffect(() => {
    if (step !== 'review' || !meter) return;
    const p = payload();
    if (p.values.length === 0) return;
    const h = setTimeout(() => {
      post<RegisterWarnings[]>(`/meters/${meter.id}/readings/check`, p).then(setWarnings).catch(() => {});
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, readAt, meterId, step]);

  const save = async () => {
    if (!meter) return setError('Bitte den Zähler wählen.');
    const p = payload();
    if (p.values.length === 0) return setError('Bitte den Zählerstand eingeben.');
    setSaving(true);
    setError(null);
    try {
      await post(`/meters/${meter.id}/readings`, p);
      await qc.invalidateQueries();
      setSavedName(meter.name);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const fileInputs = (
    <>
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile(e.currentTarget.files?.[0])} />
      <input ref={libraryInput} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.currentTarget.files?.[0])} />
    </>
  );

  if (step === 'start') {
    return (
      <Stack maw={520} mx="auto" gap="lg" pt="md">
        {fileInputs}
        <Title order={2}>Zähler ablesen</Title>
        <Button size="xl" h={120} leftSection={<IconCamera size={36} />} onClick={() => cameraInput.current?.click()}>
          Zähler fotografieren
        </Button>
        <Text c="dimmed" size="sm">
          Den Zähler möglichst gerade und ohne Spiegelung fotografieren, die Zählernummer gern mit aufs Bild. MeterBook erkennt, welcher
          Zähler es ist, und liest den Stand ab – du prüfst nur noch.
        </Text>
        <Group grow>
          <Button variant="default" leftSection={<IconPhoto size={18} />} onClick={() => libraryInput.current?.click()}>
            Aus Fotos wählen
          </Button>
          <Button variant="default" leftSection={<IconKeyboard size={18} />} onClick={() => setStep('review')}>
            Ohne Foto
          </Button>
        </Group>
        {error && <Alert color="red">{error}</Alert>}
      </Stack>
    );
  }

  if (step === 'working') {
    return (
      <Stack maw={520} mx="auto" align="center" pt={60} gap="md">
        {image && <Image src={image.url} radius="md" mah={260} fit="contain" />}
        <Loader />
        <Text>{status}</Text>
        <Text size="xs" c="dimmed">
          Das dauert meist 10–30 Sekunden.
        </Text>
      </Stack>
    );
  }

  if (step === 'done') {
    return (
      <Stack maw={520} mx="auto" align="center" pt={60} gap="lg">
        {fileInputs}
        <ThemeIcon size={72} radius="xl" color="green">
          <IconCheck size={44} />
        </ThemeIcon>
        <Title order={3}>{savedName}: gespeichert</Title>
        <Button size="lg" fullWidth leftSection={<IconCamera size={22} />} onClick={() => { reset(); cameraInput.current?.click(); }}>
          Nächsten Zähler fotografieren
        </Button>
        <Button variant="default" fullWidth component={Link} to="/">
          Zur Übersicht
        </Button>
      </Stack>
    );
  }

  // --- Prüfen
  const ocrFor = (id: string) => upload?.ocr?.registers.find((r) => r.registerId === id);
  return (
    <Stack maw={520} mx="auto" gap="md" pb={100}>
      {fileInputs}
      {image && (
        <Card withBorder p={0} onClick={() => setZoom(true)} style={{ cursor: 'zoom-in' }}>
          <Image src={crop ?? image.url} mah={crop ? 220 : 300} fit="contain" />
          <Text size="xs" c="dimmed" ta="center" py={4}>
            {crop ? 'Erkannte Ziffern · antippen für das ganze Foto' : 'Antippen zum Vergrößern'}
          </Text>
        </Card>
      )}

      <Select
        label={autoAssigned ? 'Zähler (automatisch erkannt)' : 'Zähler'}
        placeholder="Bitte wählen"
        data={(meters.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
        value={meterId}
        onChange={(v) => void chooseMeter(v)}
        allowDeselect={false}
        size="md"
        leftSection={meter ? <ThemeIcon variant="light" size="sm" color={ICON_COLOR[iconOf(meter)]}><MediumIcon meter={meter} size={14} /></ThemeIcon> : undefined}
      />
      {upload && !upload.meterId && !meterId && (
        <Alert color="orange" icon={<IconAlertTriangle size={16} />}>
          Der Zähler wurde nicht erkannt – bitte oben auswählen.
        </Alert>
      )}
      {upload?.ocr && meter && (
        <Badge leftSection={<IconSparkles size={12} />} variant="light" size="lg">
          Automatisch erkannt – bitte prüfen
        </Badge>
      )}
      {upload?.ocr?.serialNumberMatches === false && (
        <Alert color="orange">
          Auf dem Foto steht die Zählernummer {upload.ocr.serialNumberSeen}, erwartet wird {meter?.serialNumber}. Richtiger Zähler?
        </Alert>
      )}
      {upload?.ocrError && <Alert color="orange">Erkennung nicht möglich: {upload.ocrError}</Alert>}

      {meter?.registers.map((r) => {
        const ocr = ocrFor(r.id);
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
              rightSection={<Text size="sm" c="dimmed" pr="xs">{meter.unit}</Text>}
              rightSectionWidth={54}
              classNames={{ input: 'tabular' }}
            />
            {ocr && (
              <Text size="xs" c={ocr.confidence < 0.6 ? 'yellow.8' : 'dimmed'}>
                erkannt „{ocr.digits}“ · Sicherheit {Math.round(ocr.confidence * 100)} %
                {ocr.confidence < 0.6 ? ' – bitte Ziffern mit dem Foto vergleichen' : ''}
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
        </>
      )}
      {error && <Alert color="red">{error}</Alert>}

      <Group grow>
        <Button variant="default" onClick={reset}>
          Abbrechen
        </Button>
        <Button size="md" onClick={() => void save()} loading={saving} disabled={!meter}>
          {warnings.some((w) => w.warnings.length > 0) ? 'Trotzdem speichern' : 'Speichern'}
        </Button>
      </Group>

      <Modal opened={zoom} onClose={() => setZoom(false)} fullScreen title="Foto" padding={0}>
        {image && (
          <Center p="xs">
            {/* Mit zwei Fingern zoomen ist im Browser eingebaut */}
            <img src={image.url} alt="Foto des Zählers" style={{ maxWidth: '100%', touchAction: 'pinch-zoom' }} />
          </Center>
        )}
      </Modal>
    </Stack>
  );
}
