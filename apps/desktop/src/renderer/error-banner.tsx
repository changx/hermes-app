import type { ReactNode } from 'react';
import type { DesktopSnapshot } from '../shared/desktop-api';

/**
 * Connection error banner. An action error (for example a request that is no
 * longer pending) has a close button; a live connection problem has none and
 * stays until the connection recovers.
 */
export function ErrorBanner({ snapshot }: { snapshot: DesktopSnapshot }): ReactNode {
  if (!snapshot.errorMessage) return null;
  const dismiss = () => void window.hermesDesktop.dismissError(snapshot.selectedThreadId).catch(() => {});
  return <div className="error-banner" role="alert">
    <span className="error-banner-text">{snapshot.errorMessage}</span>
    {snapshot.errorDismissible ? <button type="button" className="error-banner-close" aria-label="Close message" title="Close" onClick={dismiss}>×</button> : null}
  </div>;
}
