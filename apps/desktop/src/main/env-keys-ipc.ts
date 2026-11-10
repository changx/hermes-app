import { ENV_KEY_MAX_VALUE, ENV_KEY_NAME } from "@hermes-app/client";

/**
 * Checked shapes of API key IPC payloads (docs/env-keys.md). A value goes to the server
 * once and is never kept in the main process. Pure: unit-tested in tests/env-keys-ipc.test.mjs.
 */
const invalid = (): never => { throw new Error("Invalid desktop request"); };

export const envKeyName = (value: unknown): string =>
  typeof value === "string" && ENV_KEY_NAME.test(value) ? value : invalid();

/** One line of plain text, as the server requires. */
export const envKeyValue = (value: unknown): string =>
  typeof value === "string" && value.trim() !== "" && value.length <= ENV_KEY_MAX_VALUE && !/[\r\n]/.test(value) ? value : invalid();
