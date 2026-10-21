import { ActionIcon, Popover, TextInput } from '@mantine/core';
import { DateInput, DateInputProps, DatePicker } from '@mantine/dates';
import { IconCalendar } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { parseDateInput, parseDateOnlyInput } from '../lib/parse';

type BaseProps = Omit<DateInputProps, 'value' | 'onChange' | 'valueFormat' | 'dateParser'>;

const show = (v: string) => (v ? dayjs(v).format('DD.MM.YYYY HH:mm') : '');

/**
 * Zeitpunkt zum Tippen, Einfügen oder Auswählen. "02.08.2025" wird zu 02.08.2025 10:00,
 * "02.08.2025 14:30" übernimmt die Uhrzeit. Wert und onChange im Format "YYYY-MM-DD HH:mm:ss".
 *
 * Bewusst ein Textfeld statt Mantines DateInput: Der kennt in Mantine 8 nur den Tag und würde
 * die Uhrzeit beim Tippen verwerfen.
 */
export function DateTimeField({
  label,
  description,
  value,
  onChange,
  maxDate,
}: {
  label?: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  maxDate?: string;
}) {
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Änderungen von außen (z. B. Zeitpunkt aus dem Foto) übernehmen, solange nicht getippt wird
  useEffect(() => {
    if (!focused) setText(show(value));
  }, [value, focused]);

  const commit = () => {
    if (text.trim() === '') {
      setText(show(value));
      setError(null);
      return;
    }
    const parsed = parseDateInput(text);
    if (!parsed) {
      setError('Bitte als TT.MM.JJJJ oder TT.MM.JJJJ SS:MM eingeben');
      return;
    }
    if (maxDate && dayjs(parsed).isAfter(dayjs(maxDate).add(10, 'minute'))) {
      setError('Der Zeitpunkt liegt in der Zukunft');
      return;
    }
    setError(null);
    setText(show(parsed));
    if (parsed !== value) onChange(parsed);
  };

  return (
    <TextInput
      label={label}
      description={description}
      placeholder="TT.MM.JJJJ SS:MM"
      value={text}
      error={error}
      leftSectionPointerEvents="all"
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
      leftSection={
        <Popover opened={open} onChange={setOpen} position="bottom-start" shadow="md">
          <Popover.Target>
            <ActionIcon variant="subtle" color="gray" onClick={() => setOpen((o) => !o)} aria-label="Kalender">
              <IconCalendar size={16} />
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown>
            <DatePicker
              value={value ? value.slice(0, 10) : null}
              maxDate={maxDate ? maxDate.slice(0, 10) : undefined}
              onChange={(d) => {
                if (!d) return;
                // Im Kalender wählt man den Tag – die Uhrzeit bleibt (neu: 10:00)
                const next = `${d.slice(0, 10)} ${value.slice(11) || '10:00:00'}`;
                setOpen(false);
                setError(null);
                setText(show(next));
                onChange(next);
              }}
            />
          </Popover.Dropdown>
        </Popover>
      }
    />
  );
}

/** Datum ohne Uhrzeit zum Tippen, Einfügen oder Auswählen. Wert im Format "YYYY-MM-DD". */
export function DateField({ value, onChange, ...props }: BaseProps & { value: string; onChange: (v: string) => void }) {
  return (
    <DateInput
      placeholder="TT.MM.JJJJ"
      leftSection={<IconCalendar size={16} />}
      {...props}
      value={value}
      valueFormat="DD.MM.YYYY"
      dateParser={(s) => parseDateOnlyInput(s)}
      onChange={(v) => v && onChange(v.slice(0, 10))}
    />
  );
}
