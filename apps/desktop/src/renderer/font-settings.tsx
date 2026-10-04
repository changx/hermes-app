import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_FONT_SIZE, FONT_SIZES, fontLoadFailed, getFontSize, setFontSize } from './font-preference';

const FontSettingsDialog = ({ close }: { close: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [size, setSize] = useState(getFontSize);
  const [error, setError] = useState(() => fontLoadFailed() ? 'Your saved text size could not be loaded. Choose a size to save it again.' : '');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const change = (value: number) => {
    const saved = setFontSize(value);
    setSize(getFontSize());
    setError(saved ? '' : 'This text size applies now, but could not be saved. It may reset when you reopen the app.');
  };
  return <dialog ref={dialog} className="editor-dialog font-settings" aria-labelledby="font-settings-title" onClose={close}>
    <h2 id="font-settings-title">Settings</h2>
    <label>Text size<select autoFocus aria-label="Text size" value={size} onChange={event => change(Number(event.target.value))}>
      {FONT_SIZES.map(value => <option key={value} value={value}>{value} px{value === DEFAULT_FONT_SIZE ? ' (default)' : ''}</option>)}
    </select></label>
    <p className="session-hint">Applies to interface and message text on this device.</p>
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="secondary" onClick={() => change(DEFAULT_FONT_SIZE)}>Reset to 16</button><button type="button" onClick={() => dialog.current?.close()}>Done</button></div>
  </dialog>;
};

export const FontSettingsButton = ({ className }: { className?: string }) => {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => { setOpen(false); button.current?.focus(); };
  return <>
    <button ref={button} type="button" className={className} title="Settings" aria-label="Settings" aria-haspopup="dialog" onClick={() => setOpen(true)}>⚙</button>
    {open && createPortal(<FontSettingsDialog close={close} />, document.body)}
  </>;
};
