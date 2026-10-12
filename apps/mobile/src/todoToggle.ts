import { hasTodo, toggledTodo, TodoLimitError } from '../../../packages/client/src/todo.ts';

type LabelClient = {
  threads: ReadonlyMap<string, { markers?: readonly string[] }>;
  saveThreadLabels(id: string, markers: string[], timestamp: number): Promise<{ markers: readonly string[] }>;
};

/**
 * Sets or clears one session's todo flag through the normal label save.
 * Resolves with an empty string after the server read-back confirms it,
 * otherwise with a short message for the user.
 */
export async function setThreadTodo(client: LabelClient, threadId: string, on: boolean): Promise<string> {
  let next: string[];
  try { next = toggledTodo(client.threads.get(threadId)?.markers, on); }
  catch (error) { return error instanceof TodoLimitError ? error.message : TODO_FAILURE; }
  try {
    const saved = await client.saveThreadLabels(threadId, next, Date.now());
    return hasTodo(saved.markers) === on ? '' : 'Labels changed on another device. Try again.';
  } catch { return TODO_FAILURE; }
}
export const TODO_FAILURE = 'Could not update the todo flag. Check the connection and try again.';
