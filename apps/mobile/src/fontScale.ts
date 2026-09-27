// Only fixed device preference multipliers may be used in generated CSS.
export function safeFontScale(value: number): number {
  return value === 0.9 || value === 1 || value === 1.15 || value === 1.3 ? value : 1;
}
