import type { ReactNode } from 'react';

/**
 * Glyphs from the bundled HermesWorkIcons font (assets/work-icons.ttf,
 * built by scripts/build-work-icons.py). Decorative only: the control that
 * contains an icon carries the accessible name.
 */
export const ICONS = { chevronDown: '\ue001', chevronRight: '\ue002', chevronLeft: '\ue003', gear: '\ue010', compose: '\ue011', plus: '\ue012', more: '\ue013', filter: '\ue014' } as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, className = '' }: { name: IconName; className?: string }): ReactNode {
  return <span className={`app-icon ${className}`.trim()} aria-hidden="true">{ICONS[name]}</span>;
}
