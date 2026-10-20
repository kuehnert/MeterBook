import { ActionIcon, Badge, Button, Card, Group, Modal, PasswordInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { User, currentUser, del, get, patch, post } from '../lib/api';

interface Draft {
  id?: string;
  email: string;
  name: string;
  password: string;
  role: 'ADMIN' | 'USER';
}

export function UsersPage() {
  const qc = useQueryClient();
  const me = currentUser();
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<User[]>('/users') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      if (draft.id) {
        await patch(`/users/${draft.id}`, { name: draft.name, role: draft.role, password: draft.password || undefined });
      } else {
        await post('/users', draft);
      }
      await qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: draft.id ? 'Gespeichert' : `Konto für ${draft.name} angelegt` });
      setDraft(null);
    } catch (e) {
      notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Fehler' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack maw={800}>
      <Group justify="space-between">
        <div>
          <Title order={2}>Nutzer</Title>
          <Text size="sm" c="dimmed">
            Jedes Konto hat eigene Zähler und Daten. Die Zugangsdaten gibst du an die Person weiter; sie kann ihr Passwort danach selbst ändern.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setDraft({ email: '', name: '', password: '', role: 'USER' })}>
          Nutzer anlegen
        </Button>
      </Group>
      <Card withBorder p={0}>
        <Table>
          <Table.Tbody>
            {(users.data ?? []).map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {u.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {u.email}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={u.role === 'ADMIN' ? 'blue' : 'gray'}>
                    {u.role === 'ADMIN' ? 'Administrator' : 'Nutzer'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap={2} justify="flex-end">
                    <ActionIcon variant="subtle" aria-label="Bearbeiten" onClick={() => setDraft({ id: u.id, email: u.email, name: u.name, password: '', role: u.role })}>
                      <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label="Löschen"
                      disabled={u.id === me?.id}
                      onClick={() =>
                        modals.openConfirmModal({
                          title: `Konto von ${u.name} löschen?`,
                          children: <Text size="sm">Alle Zähler, Ablesungen und Fotos dieses Kontos werden endgültig gelöscht.</Text>,
                          labels: { confirm: 'Endgültig löschen', cancel: 'Abbrechen' },
                          confirmProps: { color: 'red' },
                          onConfirm: async () => {
                            try {
                              await del(`/users/${u.id}`);
                              await qc.invalidateQueries({ queryKey: ['users'] });
                            } catch (e) {
                              notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Fehler' });
                            }
                          },
                        })
                      }
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Nutzer bearbeiten' : 'Nutzer anlegen'}>
        {draft && (
          <Stack>
            <TextInput label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} required />
            <TextInput label="E-Mail" type="email" value={draft.email} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, email: e.currentTarget.value })} required />
            <PasswordInput
              label={draft.id ? 'Neues Passwort' : 'Passwort'}
              description={draft.id ? 'Leer lassen, um es nicht zu ändern' : 'Mindestens 8 Zeichen'}
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.currentTarget.value })}
              autoComplete="new-password"
            />
            <Select
              label="Rolle"
              data={[
                { value: 'USER', label: 'Nutzer' },
                { value: 'ADMIN', label: 'Administrator (darf Nutzer verwalten)' },
              ]}
              value={draft.role}
              onChange={(v) => v && setDraft({ ...draft, role: v as Draft['role'] })}
              allowDeselect={false}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDraft(null)}>
                Abbrechen
              </Button>
              <Button onClick={save} loading={busy}>
                Speichern
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
