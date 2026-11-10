import type { NewVaultItem, VaultItemChange } from "@hermes-app/client";
import type { DesktopVaultAnswer } from "../shared/desktop-api";

/**
 * Checked shapes of vault IPC payloads (docs/vault.md). The values are passed on to the server
 * once and never kept in the main process. Pure: unit-tested in tests/vault-ipc.test.mjs.
 */
const invalid = (): never => { throw new Error("Invalid desktop request"); };
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const text = (value: unknown, maximum: number): string =>
  typeof value === "string" && value.length <= maximum ? value : invalid();
const optionalText = (value: unknown, maximum: number): string | undefined =>
  value === undefined || value === "" ? undefined : text(value, maximum);

export const vaultAnswer = (value: unknown): DesktopVaultAnswer => {
  const body = object(value);
  if (body.decision === "decline") return { decision: "decline" };
  if (body.decision === "use") return { decision: "use", item_id: text(body.item_id, 200) };
  if (body.decision !== "submit") return invalid();
  if (typeof body.code === "string") return { decision: "submit", code: text(body.code, 16) };
  const otp = optionalText(body.otp_secret, 512);
  return { decision: "submit", identifier: text(body.identifier, 320), password: text(body.password, 1024), ...(otp ? { otp_secret: otp } : {}) };
};

export const newVaultItem = (value: unknown): NewVaultItem => {
  const body = object(value), secret = object(body.secret), label = text(body.label, 120);
  if (body.kind === "login") {
    const otp = optionalText(secret.otp_secret, 512);
    return { kind: "login", label, origin: text(body.origin, 300), secret: { identifier: text(secret.identifier, 320), password: text(secret.password, 1024), ...(otp ? { otp_secret: otp } : {}) } };
  }
  if (body.kind !== "address") return invalid();
  return { kind: "address", label, ...(optionalText(body.origin, 300) ? { origin: optionalText(body.origin, 300) } : {}), secret: address(secret) };
};

const address = (secret: Record<string, unknown>) => {
  const field = (key: string) => optionalText(secret[key], 200);
  return { address_line1: text(secret.address_line1, 200), city: text(secret.city, 200), postal_code: text(secret.postal_code, 200), country: text(secret.country, 200),
    ...(field("address_line2") ? { address_line2: field("address_line2") } : {}), ...(field("state") ? { state: field("state") } : {}) };
};

/** A saved login's change (empty fields keep the saved value). Addresses are not edited from desktop. */
export const vaultItemChange = (value: unknown): VaultItemChange => {
  const body = object(value);
  if (body.secret !== undefined) return { ...(optionalText(body.label, 120) ? { label: optionalText(body.label, 120) } : {}), secret: address(object(body.secret)) };
  const pick = (key: string, maximum: number) => { const v = optionalText(body[key], maximum); return v === undefined ? {} : { [key]: v }; };
  return { ...pick("label", 120), ...pick("origin", 300), ...pick("identifier", 320), ...pick("password", 1024), ...pick("otp_secret", 512),
    ...(body.clear_otp === true ? { clear_otp: true } : {}) };
};
