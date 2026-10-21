import { NumberInput, NumberInputProps } from '@mantine/core';
import { parseDecimal } from '../lib/parse';
import { useNumberFormat } from '../lib/prefs';

/**
 * Zahlenfeld mit dem eingestellten Zahlenformat. Eingefügter Text wird selbst gelesen, damit
 * z. B. "79,820.00" von der Website des Versorgers als 79820 ankommt und nicht als 79,8.
 */
export function DecimalInput({ onChange, ...props }: Omit<NumberInputProps, 'decimalSeparator' | 'thousandSeparator'>) {
  const format = useNumberFormat();
  return (
    <NumberInput
      {...props}
      onChange={onChange}
      decimalSeparator={format === 'de' ? ',' : '.'}
      thousandSeparator={format === 'de' ? '.' : ','}
      onPaste={(e) => {
        const value = parseDecimal(e.clipboardData.getData('text'), format);
        if (value === null) return;
        e.preventDefault();
        // Wie beim Server: überzählige Nachkommastellen abschneiden, nie aufrunden.
        const f = 10 ** (props.decimalScale ?? 6);
        onChange?.(Math.trunc(value * f + Math.sign(value) * 1e-6) / f);
      }}
    />
  );
}
