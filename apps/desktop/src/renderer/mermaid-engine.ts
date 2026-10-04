type Engine = typeof import('mermaid')['default'];

/** Coalesce concurrent first use; reset a failed load so a later mount can retry. */
export function createMermaidLoader(load: () => Promise<{ default: Engine }>) {
  let pending: Promise<Engine> | undefined;
  return () => {
    if (!pending) {
      const job = load().then(({ default: engine }) => {
        engine.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, maxTextSize: 20_000, theme: 'neutral' });
        return engine;
      });
      pending = job;
      void job.catch(() => { if (pending === job) pending = undefined; });
    }
    return pending;
  };
}

export const getMermaid = createMermaidLoader(() => import('mermaid'));
