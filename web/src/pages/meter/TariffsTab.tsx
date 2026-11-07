import { ActionIcon, Autocomplete, Button, Card, Group, Modal, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { del, get, post, put } from '../../lib/api';
import { date, eur, fromPriceInput, toPriceInput, unitPrice, usesCent } from '../../lib/format';
import { DateField } from '../../components/DateFields';
import { DecimalInput } from '../../components/DecimalInput';
import type { Advance, Meter, Tariff } from '../../lib/types';

const DAY_FMT = 'YYYY-MM-DD';
/** Übliche Boni bei deutschen Stromtarifen */
const BONUS_LABELS = ['Neukundenbonus', 'Sofortbonus', 'Wechselbonus', 'Treuebonus'];
type BonusDraft = { label: string; amount: number | '' };
const emptyBonuses = (): BonusDraft[] => [
  { label: 'Neukundenbonus', amount: '' },
  { label: 'Sofortbonus', amount: '' },
];

interface TariffDraft {
  id?: string;
  name: string;
  provider: string;
  validFrom: string;
  basePricePerYear: number | '';
  components: Array<{ registerId: string; label: string; pricePerUnit: number | '' }>;
  bonuses: BonusDraft[];
}

export function TariffsTab({ meter }: { meter: Meter }) {
  const qc = useQueryClient();
  const tariffs = useQuery({ queryKey: ['tariffs', meter.id], queryFn: () => get<Tariff[]>(`/meters/${meter.id}/tariffs`) });
  const advances = useQuery({ queryKey: ['advances', meter.id], queryFn: () => get<Advance[]>(`/meters/${meter.id}/advances`) });
  const [draft, setDraft] = useState<TariffDraft | null>(null);
  const [adv, setAdv] = useState<{ id?: string; validFrom: string; amountPerMonth: number | ''; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Eingabe in ct/kWh bzw. €/m³; gespeichert wird immer € pro Einheit
  const unitLabel = usesCent(meter.unit) ? `ct/${meter.unit}` : `€/${meter.unit}`;
  const toInput = (eurPerUnit: number) => toPriceInput(eurPerUnit, meter.unit);

  const newTariff = (): TariffDraft => {
    const last = tariffs.data?.[tariffs.data.length - 1];
    return {
      name: '',
      // Anbieter bleibt meist gleich; Boni gibt es nur beim Wechsel, daher leer
      provider: last?.provider ?? '',
      bonuses: emptyBonuses(),
      validFrom: dayjs().startOf('month').format(DAY_FMT),
      basePricePerYear: last?.basePricePerYear ?? '',
      components: last
        ? last.components.map((c) => ({ registerId: c.registerId, label: c.label, pricePerUnit: toInput(c.pricePerUnit) }))
        : meter.registers.map((r) => ({
            registerId: r.id,
            label: meter.medium === 'WATER' ? 'Frischwasser' : `Arbeitspreis ${meter.registers.length > 1 ? r.name : ''}`.trim(),
            pricePerUnit: '',
          })),
    };
  };

  const providers = [...new Set((tariffs.data ?? []).map((t) => t.provider).filter((x): x is string => !!x))];

  const fail = (e: unknown) => notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Fehler' });

  const saveTariff = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const body = {
        name: draft.name || undefined,
        provider: draft.provider.trim() || undefined,
        bonuses: draft.bonuses
          .filter((b) => b.amount !== '' && Number(b.amount) > 0)
          .map((b) => ({ label: b.label.trim() || 'Bonus', amount: Number(b.amount) })),
        validFrom: dayjs(draft.validFrom).startOf('day').toISOString(),
        basePricePerYear: Number(draft.basePricePerYear || 0),
        components: draft.components
          .filter((c) => c.pricePerUnit !== '')
          .map((c) => ({ registerId: c.registerId, label: c.label || 'Arbeitspreis', pricePerUnit: fromPriceInput(Number(c.pricePerUnit), meter.unit) })),
      };
      if (draft.id) await put(`/meters/${meter.id}/tariffs/${draft.id}`, body);
      else await post(`/meters/${meter.id}/tariffs`, body);
      await qc.invalidateQueries();
      setDraft(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const saveAdvance = async () => {
    if (!adv) return;
    setBusy(true);
    try {
      const body = { validFrom: dayjs(adv.validFrom).startOf('day').toISOString(), amountPerMonth: Number(adv.amountPerMonth || 0), note: adv.note || undefined };
      if (adv.id) await put(`/meters/${meter.id}/advances/${adv.id}`, body);
      else await post(`/meters/${meter.id}/advances`, body);
      await qc.invalidateQueries();
      setAdv(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (title: string, path: string) =>
    modals.openConfirmModal({
      title,
      labels: { confirm: 'Löschen', cancel: 'Abbrechen' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await del(path);
          await qc.invalidateQueries();
        } catch (e) {
          fail(e);
        }
      },
    });

  const regName = (id: string) => meter.registers.find((r) => r.id === id)?.name ?? '';

  return (
    <Stack>
      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <div>
            <Title order={4}>Tarife</Title>
            <Text size="sm" c="dimmed">
              Ein Tarif gilt ab seinem Startdatum bis zum nächsten Tarif. Preise brutto.
            </Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setDraft(newTariff())}>
            Tarif hinzufügen
          </Button>
        </Group>
        <Table.ScrollContainer minWidth={520}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Gültig ab</Table.Th>
                <Table.Th>Arbeitspreise</Table.Th>
                <Table.Th ta="right">Grundpreis / Jahr</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(tariffs.data ?? [])
                .slice()
                .reverse()
                .map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td>
                      <Text size="sm">{date(t.validFrom)}</Text>
                      {(t.provider || t.name) && (
                        <Text size="xs" c="dimmed">
                          {[t.provider, t.name].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {t.components.map((c) => (
                        <Text key={c.id} size="sm">
                          {c.label}
                          {meter.registers.length > 1 && !c.label.includes(regName(c.registerId)) ? ` (${regName(c.registerId)})` : ''}: {unitPrice(c.pricePerUnit, meter.unit)}
                        </Text>
                      ))}
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {eur(t.basePricePerYear)}
                      {t.bonuses.map((b) => (
                        <Text key={b.id} size="xs" c="green">
                          − {eur(b.amount)} {b.label}
                        </Text>
                      ))}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={2} justify="flex-end" wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          aria-label="Bearbeiten"
                          onClick={() =>
                            setDraft({
                              id: t.id,
                              name: t.name ?? '',
                              provider: t.provider ?? '',
                              bonuses: [0, 1].map((k) =>
                                t.bonuses[k] ? { label: t.bonuses[k].label, amount: t.bonuses[k].amount } : emptyBonuses()[k],
                              ),
                              validFrom: dayjs(t.validFrom).format(DAY_FMT),
                              basePricePerYear: t.basePricePerYear,
                              components: t.components.map((c) => ({ registerId: c.registerId, label: c.label, pricePerUnit: toInput(c.pricePerUnit) })),
                            })
                          }
                        >
                          <IconEdit size={16} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="red" aria-label="Löschen" onClick={() => confirmDelete('Tarif löschen?', `/meters/${meter.id}/tariffs/${t.id}`)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {tariffs.data?.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" p="md">
            Noch kein Tarif – ohne Tarif werden keine Kosten berechnet.
          </Text>
        )}
      </Card>

      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <div>
            <Title order={4}>Abschläge</Title>
            <Text size="sm" c="dimmed">
              Monatliche Vorauszahlung an den Versorger, für die Prognose von Nachzahlung oder Guthaben.
            </Text>
          </div>
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setAdv({ validFrom: dayjs().startOf('month').format(DAY_FMT), amountPerMonth: '', note: '' })}>
            Abschlag hinzufügen
          </Button>
        </Group>
        <Table>
          <Table.Tbody>
            {(advances.data ?? [])
              .slice()
              .reverse()
              .map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td>ab {date(a.validFrom)}</Table.Td>
                  <Table.Td ta="right" className="tabular">
                    {eur(a.amountPerMonth)} / Monat
                  </Table.Td>
                  <Table.Td c="dimmed">{a.note}</Table.Td>
                  <Table.Td>
                    <Group gap={2} justify="flex-end" wrap="nowrap">
                      <ActionIcon variant="subtle" aria-label="Bearbeiten" onClick={() => setAdv({ id: a.id, validFrom: dayjs(a.validFrom).format(DAY_FMT), amountPerMonth: a.amountPerMonth, note: a.note ?? '' })}>
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" color="red" aria-label="Löschen" onClick={() => confirmDelete('Abschlag löschen?', `/meters/${meter.id}/advances/${a.id}`)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
          </Table.Tbody>
        </Table>
        {advances.data?.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" p="md">
            Keine Abschläge hinterlegt.
          </Text>
        )}
      </Card>

      <Modal opened={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Tarif bearbeiten' : 'Neuer Tarif'}>
        {draft && (
          <Stack>
            <DateField label="Gültig ab" value={draft.validFrom} onChange={(v) => setDraft({ ...draft, validFrom: v })} />
            <Autocomplete
              label="Anbieter"
              placeholder="z. B. Stadtwerke"
              data={providers}
              value={draft.provider}
              onChange={(v) => setDraft({ ...draft, provider: v })}
            />
            <TextInput label="Bezeichnung" placeholder="z. B. Preisanpassung 2026" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} />
            <DecimalInput
              label="Grundpreis pro Jahr"
              description="Monatspreis? Einfach z. B. 12 * 9,95 eintippen – gerechnet wird beim Verlassen des Felds."
              value={draft.basePricePerYear}
              onChange={(v) => setDraft({ ...draft, basePricePerYear: v === '' ? '' : Number(v) })}
              decimalScale={2}
              min={0}
              rightSection={<Text size="sm" c="dimmed">€</Text>}
            />
            <Text size="sm" fw={500}>
              Boni
            </Text>
            {draft.bonuses.map((b, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Autocomplete
                  aria-label={`Art des ${i + 1}. Bonus`}
                  data={BONUS_LABELS}
                  value={b.label}
                  onChange={(v) => {
                    const bonuses = [...draft.bonuses];
                    bonuses[i] = { ...b, label: v };
                    setDraft({ ...draft, bonuses });
                  }}
                  style={{ flex: 1 }}
                />
                <DecimalInput
                  aria-label={`Betrag des ${i + 1}. Bonus`}
                  placeholder="0,00"
                  value={b.amount}
                  onChange={(v) => {
                    const bonuses = [...draft.bonuses];
                    bonuses[i] = { ...b, amount: v === '' ? '' : Number(v) };
                    setDraft({ ...draft, bonuses });
                  }}
                  decimalScale={2}
                  min={0}
                  w={120}
                  rightSection={<Text size="sm" c="dimmed">€</Text>}
                />
              </Group>
            ))}
            <Text size="xs" c="dimmed" mt={-8}>
              Boni beim Anbieterwechsel werden über das erste Vertragsjahr ab „Gültig ab“ verteilt von den Kosten abgezogen. Leer lassen, wenn es keine gibt.
            </Text>
            <Text size="sm" fw={500}>
              Arbeitspreise
            </Text>
            {draft.components.map((c, i) => (
              <Group key={i} gap="xs" align="flex-end" wrap="nowrap">
                <TextInput
                  label={meter.registers.length > 1 ? `Bezeichnung (${regName(c.registerId)})` : 'Bezeichnung'}
                  value={c.label}
                  onChange={(e) => {
                    const components = [...draft.components];
                    components[i] = { ...c, label: e.currentTarget.value };
                    setDraft({ ...draft, components });
                  }}
                  style={{ flex: 1 }}
                />
                <DecimalInput
                  label={unitLabel}
                  value={c.pricePerUnit}
                  onChange={(v) => {
                    const components = [...draft.components];
                    components[i] = { ...c, pricePerUnit: v === '' ? '' : Number(v) };
                    setDraft({ ...draft, components });
                  }}
                  decimalScale={4}
                  min={0}
                  w={120}
                  hideControls
                />
                <ActionIcon variant="subtle" color="red" mb={4} aria-label="Entfernen" onClick={() => setDraft({ ...draft, components: draft.components.filter((_, j) => j !== i) })}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            <Group gap="xs">
              {meter.registers.map((r) => (
                <Button
                  key={r.id}
                  variant="subtle"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => setDraft({ ...draft, components: [...draft.components, { registerId: r.id, label: meter.medium === 'WATER' ? 'Abwasser' : '', pricePerUnit: '' }] })}
                >
                  Preis{meter.registers.length > 1 ? ` für ${r.name}` : ''} hinzufügen
                </Button>
              ))}
            </Group>
            <Text size="xs" c="dimmed">
              Mehrere Preise je Zählwerk werden addiert – z. B. Frischwasser und Abwasser.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDraft(null)}>
                Abbrechen
              </Button>
              <Button onClick={saveTariff} loading={busy}>
                Speichern
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!adv} onClose={() => setAdv(null)} title={adv?.id ? 'Abschlag bearbeiten' : 'Neuer Abschlag'}>
        {adv && (
          <Stack>
            <DateField label="Gültig ab" value={adv.validFrom} onChange={(v) => setAdv({ ...adv, validFrom: v })} />
            <DecimalInput
              label="Betrag pro Monat"
              value={adv.amountPerMonth}
              onChange={(v) => setAdv({ ...adv, amountPerMonth: v === '' ? '' : Number(v) })}
              decimalScale={2}
              min={0}
              rightSection={<Text size="sm" c="dimmed">€</Text>}
            />
            <TextInput label="Notiz" value={adv.note} onChange={(e) => setAdv({ ...adv, note: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setAdv(null)}>
                Abbrechen
              </Button>
              <Button onClick={saveAdvance} loading={busy}>
                Speichern
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
