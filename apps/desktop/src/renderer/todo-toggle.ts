import type { DesktopThread } from '../shared/desktop-api';
import { hasTodo, toggledTodo, TodoLimitError } from '../../../../packages/client/src/todo';

/**
 * Sets or clears a Session's todo flag through the normal label save. Resolves
 * after the server read-back shows the new state. Rejects with a message the
 * user can act on.
 */
export async function setSessionTodo(thread: Pick<DesktopThread, 'id' | 'markers'>, on: boolean, connectionKey: string): Promise<void> {
  let next: string[];
  try { next = toggledTodo(thread.markers, on); }
  catch (error) { throw new Error(error instanceof TodoLimitError ? error.message : todoFailure); }
  let saved;
  try { saved = await window.hermesDesktop.saveThreadLabels(thread.id, next, Date.now(), connectionKey); }
  catch { throw new Error(todoFailure); }
  if (hasTodo(saved.markers) !== on) throw new Error('Labels changed on another device. Try again.');
}
export const todoFailure = 'Could not update the todo flag. Check the connection and try again.';
