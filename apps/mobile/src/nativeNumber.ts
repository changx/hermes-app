type File = { readonly size: number | bigint };

/**
 * Expo SDK 58 on iOS maps a native Int64 to a JS BigInt (file sizes, download
 * and upload progress). App code does Number arithmetic and exact comparisons
 * with server sizes, so native 64-bit values become Numbers here.
 */
export function nativeNumber(value: number | bigint): number;
export function nativeNumber(value: number | bigint | null | undefined): number | undefined;
export function nativeNumber(value: number | bigint | null | undefined): number | undefined {
  return typeof value === 'bigint' ? Number(value) : value ?? undefined;
}

/** The file's byte size as a Number. */
export const fileSize = (file: File): number => nativeNumber(file.size);
