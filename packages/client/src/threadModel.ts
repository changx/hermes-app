import type { AgentModelSettings, ThreadModelChoice } from './index';
// Type-only import: the desktop renderer imports this file alone (`@hermes-app/client/threadModel`).

/** One row of the new-Thread model list. `choice: null` is the connection's primary model. */
export interface ThreadModelOption { key: string; label: string; detail: string; choice: ThreadModelChoice | null }

const key = (choice: ThreadModelChoice | null) => choice ? choice.provider + '\u0000' + choice.model : 'default';

/** The primary model first, then every listed model by provider. The primary model is not repeated.
 * A query keeps the Default row and filters the rest by model or provider name. */
export function threadModelOptions(settings: AgentModelSettings, query = ''): ThreadModelOption[] {
  const needle = query.trim().toLowerCase();
  const rows: ThreadModelOption[] = [{ key: 'default', label: settings.model ? `Default (${settings.model})` : 'Default model',
    detail: 'Primary model', choice: null }];
  for (const provider of settings.providers) for (const model of provider.models) {
    if (provider.id === settings.provider && model === settings.model) continue;
    if (needle && !model.toLowerCase().includes(needle) && !provider.name.toLowerCase().includes(needle)) continue;
    const choice = { provider: provider.id, model };
    rows.push({ key: key(choice), label: model, detail: provider.name, choice });
  }
  return rows;
}

/** Compact label for the composer control. */
export function threadModelLabel(settings: AgentModelSettings | null, choice: ThreadModelChoice | null): string {
  if (choice) return choice.model;
  return settings?.model ? `Default (${settings.model})` : 'Default model';
}

export const threadModelKey = key;

/** A choice equal to the primary model is the primary model: send nothing, so the Thread follows the default. */
export function threadModelRequest(settings: AgentModelSettings | null, choice: ThreadModelChoice | null): ThreadModelChoice | undefined {
  if (!choice) return undefined;
  if (settings && choice.provider === settings.provider && choice.model === settings.model) return undefined;
  return choice;
}
