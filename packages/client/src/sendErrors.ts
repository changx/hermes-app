/** A send permission failure, not revoked read access or a reason to pair again. */
export const DEVICE_NOT_BOUND_CODE = 'device_not_bound';
export const DEVICE_NOT_BOUND_MESSAGE = 'This device is not linked to a team member. You can read but not send.';

// Structural check: native tests and applications can have separate SDK bundle copies.
export function isDeviceNotBoundError(error: unknown): boolean {
  const value = error as { status?: unknown; code?: unknown } | null;
  return value?.status === 403 && value.code === DEVICE_NOT_BOUND_CODE;
}
