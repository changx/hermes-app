export const DEFAULT_FONT_SIZE = 16;
export const FONT_SIZES = Array.from({ length: 13 }, (_, index) => index + 12);
export const FONT_SIZE_KEY = 'hermes.desktop.font-size';
let currentSize = DEFAULT_FONT_SIZE;
let loadFailed = false;

export const validFontSize = (value: number): boolean => Number.isInteger(value) && value >= 12 && value <= 24;
export const getFontSize = (): number => currentSize;
export const fontLoadFailed = (): boolean => loadFailed;

const applyFontSize = (size: number): void => {
  currentSize = size;
  document.documentElement.style.setProperty('--app-font-size', `${size}px`);
};

// Run before React mounts so saved text size applies to the first visible frame.
export const initializeFontSize = (): void => {
  let size = DEFAULT_FONT_SIZE;
  loadFailed = false;
  try {
    const stored = window.localStorage.getItem(FONT_SIZE_KEY);
    const parsed = stored === null ? DEFAULT_FONT_SIZE : Number(stored);
    if (validFontSize(parsed)) size = parsed;
  } catch {
    loadFailed = true;
  }
  applyFontSize(size);
};

export const setFontSize = (size: number): boolean => {
  if (!validFontSize(size)) return false;
  applyFontSize(size);
  try {
    window.localStorage.setItem(FONT_SIZE_KEY, String(size));
    loadFailed = false;
    return true;
  } catch {
    return false;
  }
};
