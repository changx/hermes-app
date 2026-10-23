import { createContext, createElement, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

// Session pages copy through the app; the Markdown preview page has no app API and uses the web clipboard.
export const writeClipboard = (text: string): Promise<void> => {
  try { return window.hermesDesktop?.copyText ? window.hermesDesktop.copyText(text) : navigator.clipboard.writeText(text); }
  catch (error) { return Promise.reject(error); }
};

/** Short "Copied" / "Could not copy." note after a copy; it clears itself. */
export const useCopyNote = () => {
  const [note, setNote] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!note) return; const timer = setTimeout(() => setNote(""), 1400); return () => clearTimeout(timer); }, [note]);
  const copy = (text: string) => { void writeClipboard(text).then(() => { if (mounted.current) setNote("Copied"); }, () => { if (mounted.current) setNote("Could not copy."); }); };
  return { note, copy };
};

/** True inside a fenced or indented code block, so `code` can tell block code from inline code. */
export const InCodeBlock = createContext(false);

/**
 * One line of text that copies itself on click (inline code, one-line code blocks, tool commands).
 * A click that ends a text selection inside it does not copy, so the text stays selectable.
 */
export const ClickCopy = ({ as, text, className, children }: { as: "code" | "pre"; text: string; className?: string; children: ReactNode }) => {
  const { note, copy } = useCopyNote();
  const onClick = (event: MouseEvent<HTMLElement>) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return;
    copy(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault(); copy(text);
  };
  return createElement(as, {
    className: `${className ? className + " " : ""}click-copy`, role: "button", tabIndex: 0, title: "Click to copy",
    "data-copy-note": note || undefined, onClick, onKeyDown,
  }, children);
};
