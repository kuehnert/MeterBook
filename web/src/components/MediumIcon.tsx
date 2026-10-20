import { IconBolt, IconDroplet, IconFlame, IconGauge, IconTemperature } from '@tabler/icons-react';
import type { Medium, Meter, MeterIcon } from '../lib/types';

/** Heizkörper im Stil der Tabler-Icons (gibt es dort nicht). */
function IconRadiator({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="3" height="16" rx="1.5" />
      <rect x="10.5" y="4" width="3" height="16" rx="1.5" />
      <rect x="17" y="4" width="3" height="16" rx="1.5" />
      <path d="M7 8h3.5M13.5 8h3.5M7 16h3.5M13.5 16h3.5M2 8h2M20 16h2" />
    </svg>
  );
}

export const ICON_LABEL: Record<MeterIcon, string> = {
  ELECTRICITY: 'Strom',
  HEATING: 'Heizung',
  WATER: 'Wasser',
  GAS: 'Gas',
  HEAT: 'Wärme',
  OTHER: 'Sonstiges',
};

export const ICON_COLOR: Record<MeterIcon, string> = {
  ELECTRICITY: 'yellow',
  HEATING: 'red',
  WATER: 'blue',
  GAS: 'orange',
  HEAT: 'grape',
  OTHER: 'gray',
};

/** Symbol eines Zählers: eigenes Symbol, sonst das der Zählerart. */
export function iconOf(m: Pick<Meter, 'medium' | 'icon'>): MeterIcon {
  return m.icon ?? (m.medium as Medium);
}

export function MeterIconView({ icon, size = 20 }: { icon: MeterIcon; size?: number }) {
  switch (icon) {
    case 'ELECTRICITY':
      return <IconBolt size={size} />;
    case 'HEATING':
      return <IconRadiator size={size} />;
    case 'WATER':
      return <IconDroplet size={size} />;
    case 'GAS':
      return <IconFlame size={size} />;
    case 'HEAT':
      return <IconTemperature size={size} />;
    default:
      return <IconGauge size={size} />;
  }
}

export function MediumIcon({ meter, size = 20 }: { meter: Pick<Meter, 'medium' | 'icon'>; size?: number }) {
  return <MeterIconView icon={iconOf(meter)} size={size} />;
}
