const DIAGRAM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

type Engine = typeof import('mermaid')['default'];

/** Coalesce concurrent first use; reset a failed load so a later mount can retry. */
export function createMermaidLoader(load: () => Promise<{ default: Engine }>) {
  let pending: Promise<Engine> | undefined;
  return () => {
    if (!pending) {
      const job = load().then(({ default: engine }) => {
        // Labels use the app font. Mermaid measures label text before its own CSS can apply,
        // so the same font for measuring and display keeps labels inside their boxes.
        engine.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, maxTextSize: 20_000, theme: 'neutral', fontFamily: DIAGRAM_FONT, themeVariables: { fontFamily: DIAGRAM_FONT } });
        return engine;
      });
      pending = job;
      void job.catch(() => { if (pending === job) pending = undefined; });
    }
    return pending;
  };
}

export const getMermaid = createMermaidLoader(() => import('mermaid'));
