import type { TimelineRow } from './timeline';

type Button = { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void };
type ShowAlert = (title: string, message: string | undefined, buttons: Button[]) => void;

export function failedMessageId(row: TimelineRow): string | undefined {
  return row.role === 'user' && row.optimistic === true && row.status === 'blocked' && row.refSeq === undefined && row.key.startsWith('local:')
    ? row.key.slice('local:'.length) || undefined : undefined;
}

export function confirmFailedMessageDelete(row: TimelineRow, remove: (id: string) => void, alert: ShowAlert): void {
  const id = failedMessageId(row);
  if (!id) return;
  alert('Delete this message?',
      'This removes the saved message from this device and cannot be undone. It does not delete a message already received by Hermes or stop the Agent.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove(id) }
      ]);
}
