/**
 * Home Screen icon choices. `native` is the alternate icon name declared for
 * expo-alternate-app-icons in app.json; null means the primary icon (mochi).
 */
export const APP_ICONS = [
  { id: 'mochi', label: 'Mochi', native: null },
  { id: 'bubble', label: 'Bubble', native: 'Bubble' },
  { id: 'orb', label: 'Orb', native: 'Orb' },
] as const;
export type AppIconId = typeof APP_ICONS[number]['id'];

/** Maps the name the system reports to a choice; unknown names fall back to the primary icon. */
export function appIconForNative(name: string | null | undefined): AppIconId {
  return APP_ICONS.find(icon => icon.native !== null && icon.native === name)?.id ?? 'mochi';
}

export function nativeIconName(id: AppIconId): string | null {
  return APP_ICONS.find(icon => icon.id === id)?.native ?? null;
}

export function appIconLabel(id: AppIconId): string {
  return APP_ICONS.find(icon => icon.id === id)?.label ?? 'Mochi';
}
