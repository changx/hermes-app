import { createRoot } from "react-dom/client";
import { MessageContent } from "../renderer/message-content";

// Markdown attachment preview page (hermes-preview:). The main process puts the file text in
// a JSON script element; this page renders it with the chat message renderer, so tables,
// math, code and Mermaid diagrams look the same as in a reply. The page has no app API.
const source = document.getElementById("hermes-markdown");
const host = document.getElementById("markdown-root");
if (source && host) {
  const text: unknown = JSON.parse(source.textContent || '""');
  if (typeof text === "string") createRoot(host).render(<MessageContent text={text} document />);
}
