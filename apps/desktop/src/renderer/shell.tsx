const EmptyState = ({ children }: { children: string }) => (
  <p className="empty-state">{children}</p>
);

export const DesktopShell = () => (
  <main className="desktop-shell" aria-label="Hermes desktop">
    <nav className="pane channels-pane" aria-labelledby="channels-heading">
      <header className="pane-header">
        <div>
          <p className="eyebrow">Hermes</p>
          <h1 id="channels-heading">Channels</h1>
        </div>
        <button type="button" aria-label="Create a channel" disabled>
          +
        </button>
      </header>
      <EmptyState>Connect to see your channels.</EmptyState>
    </nav>

    <nav className="pane threads-pane" aria-labelledby="threads-heading">
      <header className="pane-header">
        <h2 id="threads-heading">Threads</h2>
        <button type="button" aria-label="Create a topic" disabled>
          +
        </button>
      </header>
      <EmptyState>Choose a channel to see its threads.</EmptyState>
    </nav>

    <section
      className="pane conversation-pane"
      aria-labelledby="conversation-heading"
    >
      <header className="conversation-header">
        <div>
          <p className="eyebrow">Conversation</p>
          <h2 id="conversation-heading">Choose a thread</h2>
        </div>
        <span className="connection-state" role="status">
          Not connected
        </span>
      </header>
      <div className="conversation-empty">
        <div className="empty-mark" aria-hidden="true">
          H
        </div>
        <h3>Your conversations will appear here</h3>
        <p>Choose a thread after connecting to Hermes.</p>
      </div>
      <footer className="composer-placeholder" aria-label="Message composer">
        <textarea aria-label="Message" placeholder="Message" disabled />
        <button type="button" disabled>
          Send
        </button>
      </footer>
    </section>
  </main>
);