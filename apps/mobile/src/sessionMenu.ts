/**
 * The Session (Thread) menu shared by every list that shows a Session row.
 * One item list and one order everywhere: todo, rename, labels, archive.
 * Plain functions only, so Channel screens can use it without importing App.
 */
export type SessionMenuAction = Readonly<{ name: 'todo' | 'rename' | 'labels' | 'archive'; label: string; destructive?: boolean; run: () => void }>;
type AlertButton = { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void };
export type ShowAlert = (title: string, message: string | undefined, buttons: AlertButton[]) => void;

export function sessionMenuActions(options: {
  /** The connection supports labels: adds the todo and label items. */
  labels: boolean; todo: boolean;
  toggleTodo: () => void; editLabels: () => void; archive: () => void;
  /** Omitted when this platform has no rename entry for the row. */
  rename?: () => void;
}): SessionMenuAction[] {
  return [
    ...(options.labels ? [{ name: 'todo' as const, label: options.todo ? 'Remove todo' : 'Mark as todo', run: options.toggleTodo }] : []),
    ...(options.rename ? [{ name: 'rename' as const, label: 'Rename session', run: options.rename }] : []),
    ...(options.labels ? [{ name: 'labels' as const, label: 'Edit labels', run: options.editLabels }] : []),
    { name: 'archive', label: 'Archive session', destructive: true, run: options.archive },
  ];
}

/** Archive asks first; nothing is deleted. */
export function confirmSessionArchive(alert: ShowAlert, archive: () => void): void {
  alert('Archive this session?', 'It will no longer be shown on any device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Archive', style: 'destructive', onPress: archive },
  ]);
}

export function showSessionMenu(alert: ShowAlert, title: string, actions: readonly SessionMenuAction[]): void {
  alert(title, undefined, [
    ...actions.map(action => ({ text: action.label, onPress: action.run, ...(action.destructive ? { style: 'destructive' as const } : {}) })),
    { text: 'Cancel', style: 'cancel' },
  ]);
}

/** Long press, the hint and the screen-reader actions of one row. */
export function sessionRowProps(title: string, actions: readonly SessionMenuAction[], alert: ShowAlert, blocked: () => boolean) {
  return {
    accessibilityHint: 'Open session. Long press for options.',
    accessibilityActions: actions.map(({ name, label }) => ({ name, label })),
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => { if (!blocked()) actions.find(action => action.name === event.nativeEvent.actionName)?.run(); },
    onLongPress: () => { if (!blocked()) showSessionMenu(alert, title, actions); },
  };
}
