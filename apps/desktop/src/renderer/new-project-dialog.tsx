import type { DesktopSnapshot } from '../shared/desktop-api';
import { ProjectDialog } from './project-dialog';

/** New project uses the same modal as Project settings. */
export function NewProjectDialog({ snapshot, close }: { snapshot: DesktopSnapshot; close: () => void }) {
  return <ProjectDialog snapshot={snapshot} close={close} />;
}
