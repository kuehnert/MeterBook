import { DateInput, DateInputProps } from '@mantine/dates';
import { IconCalendar } from '@tabler/icons-react';
import { parseDateInput, parseDateOnlyInput } from '../lib/parse';

type BaseProps = Omit<DateInputProps, 'value' | 'onChange' | 'valueFormat' | 'dateParser'>;

/**
 * Zeitpunkt zum Tippen, Einfügen oder Auswählen. "02.08.2025" wird zu 02.08.2025 10:00,
 * "02.08.2025 14:30" übernimmt die Uhrzeit. Wert und onChange im Format "YYYY-MM-DD HH:mm:ss".
 */
export function DateTimeField({ value, onChange, ...props }: BaseProps & { value: string; onChange: (v: string) => void }) {
  return (
    <DateInput
      placeholder="TT.MM.JJJJ SS:MM"
      leftSection={<IconCalendar size={16} />}
      {...props}
      value={value}
      valueFormat="DD.MM.YYYY HH:mm"
      dateParser={(s) => parseDateInput(s)}
      onChange={(v) => {
        if (!v) return;
        // Auswahl im Kalender liefert nur den Tag – die bisherige Uhrzeit bleibt.
        onChange(v.length <= 10 ? `${v.slice(0, 10)} ${value.slice(11) || '10:00:00'}` : v);
      }}
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
