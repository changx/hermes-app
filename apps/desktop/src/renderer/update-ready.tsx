/**
 * Title bar, right side: shown only while a downloaded update waits for a restart
 * (docs/desktop-auto-update.md). A click does the same as "Restart to Update" in the app menu.
 */
export function UpdateReadyButton({ version, onRestart }: { version?: string; onRestart(): void }) {
  if (version === undefined) return null;
  const name = version ? `Hermes ${version}` : 'The new version of Hermes';
  return <button type="button" className="desktop-update-ready" title={`${name} is downloaded. Restart Hermes to update.`}
    aria-label={`Update ready: restart Hermes to update${version ? ` to ${version}` : ''}`} onClick={onRestart}>Update ready · Restart</button>;
}
