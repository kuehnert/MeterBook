import { IconBolt, IconDroplet, IconFlame, IconGauge, IconTemperature } from '@tabler/icons-react';
import type { Medium } from '../lib/types';

export function MediumIcon({ medium, size = 20 }: { medium: Medium; size?: number }) {
  switch (medium) {
    case 'ELECTRICITY':
      return <IconBolt size={size} />;
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
