import { useEffect, useRef, useState } from 'react';

/** A client that reports only its own changes (see LiveSessionClient.subscribe). */
export type ChangeSource = { subscribe(listener: () => void): () => void; readonly changeVersion: number };

/**
 * Battery: a retained page renders only while it is shown. Changes that arrive
 * while it is hidden are noted, and one render applies them when it is shown again.
 * The SDK keeps receiving the data in both cases; only the React work waits.
 */
export class PageUpdates {
  private visible: boolean;
  private dirty = false;
  constructor(private readonly publish: () => void, visible = true) { this.visible = visible; }
  changed(): void {
    if (this.visible) this.publish();
    else this.dirty = true;
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible && this.dirty) { this.dirty = false; this.publish(); }
  }
}

type Source = ChangeSource | null | undefined;
const versionOf = (page: Source, account: Source) => `${page?.changeVersion ?? -1},${account?.changeVersion ?? -1}`;

/**
 * A number that increases when the page or its account changes while `visible`.
 * Use it as a render/effect dependency instead of the account-wide revision.
 */
export function usePageVersion(page: Source, account: Source, visible: boolean): number {
  const [version, setVersion] = useState(0);
  const gate = useRef<PageUpdates | null>(null);
  if (!gate.current) gate.current = new PageUpdates(() => setVersion(value => value + 1), visible);
  // The versions this render read; a change before subscription is not lost.
  const renderedRef = useRef('');
  renderedRef.current = versionOf(page, account);
  useEffect(() => {
    const changed = () => gate.current?.changed();
    const stops = [page, account].flatMap(source => source ? [source.subscribe(changed)] : []);
    if (versionOf(page, account) !== renderedRef.current) changed();
    return () => { for (const stop of stops) stop(); };
  }, [page, account]);
  useEffect(() => { gate.current?.setVisible(visible); }, [visible]);
  return version;
}
