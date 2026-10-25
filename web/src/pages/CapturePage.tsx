import { Alert, Badge, Button, Group, Image, Loader, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconCamera, IconCheck, IconInbox, IconKeyboard, IconPhoto } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PhotoReview } from '../components/PhotoReview';
import { post } from '../lib/api';
import { prepareImage } from '../lib/image';
import type { UploadResult } from '../lib/types';

interface Sent {
  key: string;
  url: string;
  state: 'uploading' | 'done' | 'error';
  error?: string;
}

/**
 * Ablesen auf dem Handy: Fotos nacheinander machen – sie landen im Eingang und werden dort im
 * Hintergrund erkannt. Geprüft und gespeichert wird im Eingang, ein Foto nach dem anderen.
 */
export function CapturePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const [manual, setManual] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);

  useEffect(() => () => sent.forEach((s) => URL.revokeObjectURL(s.url)), [sent]);

  const update = (key: string, patch: Partial<Sent>) => setSent((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const sendFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const key = `${Date.now()}-${Math.random()}`;
      try {
        const img = await prepareImage(file);
        setSent((list) => [...list, { key, url: img.url, state: 'uploading' }]);
        const fd = new FormData();
        fd.append('file', img.blob, 'foto.jpg');
        // Aufnahmezeitpunkt: bei einem Foto aus der Mediathek das Dateidatum, sonst jetzt
        fd.append('takenAt', new Date(file.lastModified || Date.now()).toISOString());
        await post<UploadResult>('/photos?async=true', fd);
        update(key, { state: 'done' });
        await qc.invalidateQueries({ queryKey: ['inbox'] });
      } catch (e) {
        setSent((list) =>
          list.some((s) => s.key === key)
            ? list.map((s) => (s.key === key ? { ...s, state: 'error', error: e instanceof Error ? e.message : 'Fehler' } : s))
            : [...list, { key, url: '', state: 'error', error: e instanceof Error ? e.message : 'Fehler' }],
        );
      }
    }
  };

  const fileInputs = (
    <>
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void sendFiles(e.currentTarget.files);
          e.currentTarget.value = '';
        }}
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void sendFiles(e.currentTarget.files);
          e.currentTarget.value = '';
        }}
      />
    </>
  );

  if (savedName) {
    return (
      <Stack maw={520} mx="auto" align="center" pt={60} gap="lg">
        <ThemeIcon size={72} radius="xl" color="green">
          <IconCheck size={44} />
        </ThemeIcon>
        <Title order={3}>{savedName}: gespeichert</Title>
        <Button variant="default" fullWidth onClick={() => setSavedName(null)}>
          Weiter ablesen
        </Button>
        <Button variant="default" fullWidth component={Link} to="/">
          Zur Übersicht
        </Button>
      </Stack>
    );
  }

  if (manual) {
    return (
      <Stack maw={520} mx="auto" pb={100}>
        <Title order={3}>Ablesung ohne Foto</Title>
        <PhotoReview
          item={null}
          onSaved={(name) => {
            setManual(false);
            setSavedName(name);
          }}
          onCancel={() => setManual(false)}
        />
      </Stack>
    );
  }

  const done = sent.filter((s) => s.state === 'done').length;
  return (
    <Stack maw={520} mx="auto" gap="lg" pt="md">
      {fileInputs}
      <Title order={2}>Zähler ablesen</Title>
      <Button size="xl" h={120} leftSection={<IconCamera size={36} />} onClick={() => cameraInput.current?.click()}>
        {sent.length ? 'Nächstes Foto' : 'Zähler fotografieren'}
      </Button>
      {sent.length === 0 && (
        <Text c="dimmed" size="sm">
          Fotografiere einen oder mehrere Zähler nacheinander – möglichst gerade und ohne Spiegelung, die Zählernummer gern mit aufs Bild.
          Die Fotos landen im <b>Eingang</b>; MeterBook erkennt dort Zähler und Stand, du prüfst und speicherst.
        </Text>
      )}

      {sent.length > 0 && (
        <Stack gap="xs">
          <SimpleGrid cols={4} spacing="xs">
            {sent.map((s) => (
              <div key={s.key} style={{ position: 'relative' }}>
                {s.url ? <Image src={s.url} radius="sm" h={70} fit="cover" /> : <div style={{ height: 70 }} />}
                <Badge
                  size="xs"
                  color={s.state === 'done' ? 'green' : s.state === 'error' ? 'red' : 'blue'}
                  style={{ position: 'absolute', bottom: 4, left: 4 }}
                  leftSection={s.state === 'uploading' ? <Loader size={8} color="white" /> : undefined}
                >
                  {s.state === 'done' ? 'im Eingang' : s.state === 'error' ? 'Fehler' : 'lädt'}
                </Badge>
              </div>
            ))}
          </SimpleGrid>
          {sent
            .filter((s) => s.state === 'error')
            .map((s) => (
              <Alert key={s.key} color="red" py={6}>
                {s.error}
              </Alert>
            ))}
          {done > 0 && (
            <Button size="lg" variant="light" leftSection={<IconInbox size={20} />} onClick={() => navigate('/eingang')}>
              Zum Eingang – prüfen und speichern
            </Button>
          )}
        </Stack>
      )}

      <Group grow>
        <Button variant="default" leftSection={<IconPhoto size={18} />} onClick={() => libraryInput.current?.click()}>
          Aus Fotos wählen
        </Button>
        <Button variant="default" leftSection={<IconKeyboard size={18} />} onClick={() => setManual(true)}>
          Ohne Foto
        </Button>
      </Group>
    </Stack>
  );
}
