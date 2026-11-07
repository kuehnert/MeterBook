import { TextInput, type TextInputProps } from '@mantine/core';
import { useEffect, useState } from 'react';
import { evaluateExpression, isExpression, parseDecimal, type NumberFormat } from '../lib/parse';
import { useNumberFormat } from '../lib/prefs';

type Props = Omit<TextInputProps, 'value' | 'onChange' | 'defaultValue'> & {
  value: number | string | '';
  onChange?: (value: number | '') => void;
  /** Nachkommastellen; überzählige werden abgeschnitten (eingetippt) bzw. gerundet (Rechnung) */
  decimalScale?: number;
  min?: number;
  /** vom früheren Zahlenfeld übrig – ohne Wirkung */
  hideControls?: boolean;
};

function format(v: number | string | '', f: NumberFormat, scale: number): string {
  if (v === '' || v === null || v === undefined) return '';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString(f === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: scale, useGrouping: true });
}

/**
 * Zahlenfeld mit dem eingestellten Zahlenformat. Versteht auch Rechnungen wie „12 * 54,90“
 * oder „649,80 / 12“ – das Ergebnis erscheint beim Verlassen des Felds bzw. mit Enter.
 * Eingefügter Text wird selbst gelesen, damit z. B. "79,820.00" von der Website des
 * Versorgers als 79820 ankommt und nicht als 79,8.
 */
export function DecimalInput({ value, onChange, decimalScale = 6, min, hideControls: _h, onBlur, onFocus, onKeyDown, error, ...props }: Props) {
  const fmt = useNumberFormat();
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => format(value, fmt, decimalScale));
  const [invalid, setInvalid] = useState(false);

  // Von außen gesetzte Werte übernehmen (z. B. erkannter Zählerstand), aber nicht beim Tippen
  useEffect(() => {
    if (!focused) setText(format(value, fmt, decimalScale));
  }, [value, fmt, decimalScale, focused]);

  const f = 10 ** decimalScale;
  const trunc = (v: number) => Math.trunc(v * f + Math.sign(v) * 1e-6) / f;
  const roundTo = (v: number) => Math.round(v * f) / f;

  const handleText = (t: string) => {
    setText(t);
    setInvalid(false);
    if (t.trim() === '') return onChange?.('');
    // Einzelne Zahl sofort übernehmen (für Prüfungen während der Eingabe); Rechnungen erst am Ende
    if (isExpression(t)) return;
    const v = parseDecimal(t, fmt);
    if (v !== null) onChange?.(trunc(v));
  };

  const commit = () => {
    const t = text.trim();
    if (t === '') return;
    const v = isExpression(t) ? evaluateExpression(t, fmt) : parseDecimal(t, fmt);
    if (v === null || (min !== undefined && v < min)) {
      setInvalid(true);
      return;
    }
    const r = isExpression(t) ? roundTo(v) : trunc(v);
    onChange?.(r);
    setText(format(r, fmt, decimalScale));
  };

  return (
    <TextInput
      {...props}
      value={text}
      error={error ?? (invalid ? (min !== undefined && min >= 0 ? 'Bitte eine Zahl oder Rechnung ≥ 0 eingeben' : 'Bitte eine Zahl oder Rechnung eingeben') : undefined)}
      onChange={(e) => handleText(e.currentTarget.value)}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        commit();
        setFocused(false);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && isExpression(text)) {
          e.preventDefault();
          commit();
        }
        onKeyDown?.(e);
      }}
    />
  );
}
