import { useState, type FormEvent } from "react";
import { useDesktopSnapshot } from "./desktop-store";
import type { DesktopSnapshot } from "../shared/desktop-api";

const EmptyState = ({ children }: { children: string }) => <p className="empty-state">{children}</p>;

const PairingPanel = ({ busy }: { busy: boolean }) => {
  const [baseUrl, setBaseUrl] = useState("");
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("Hermes on Mac");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void window.hermesDesktop.pair({ baseUrl, code, deviceName }).catch(() => {});
  };
  return (
    <div className="pairing-wrap">
      <form className="pairing-card" onSubmit={submit}>
        <div className="empty-mark" aria-hidden="true">H</div>
        <h2>Connect to Hermes</h2>
        <p>Enter the one-time code provided by your administrator. Your device credential stays in macOS secure storage.</p>
        <label>Server<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={busy} inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="Your HTTPS server address" /></label>
        <label>Pairing code<input value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} autoCapitalize="characters" autoComplete="one-time-code" placeholder="XXXX-XXXX-XXXX-XXXX" /></label>
        <label>Device name<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} disabled={busy} maxLength={64} /></label>
        <div className="pairing-actions">
          <button type="submit" disabled={busy}>Connect</button>
          {busy ? <button type="button" className="secondary" onClick={() => void window.hermesDesktop.cancelPairing()}>Cancel</button> : null}
        </div>
      </form>
    </div>
  );
};

export const DesktopShellView = ({ snapshot }: { snapshot: DesktopSnapshot }) => {
  if (snapshot.phase === "restoring") return <main className="loading-screen" role="status">Opening Hermes…</main>;
  if (snapshot.phase === "unpaired" || snapshot.phase === "pairing") {
    return <main className="connection-screen"><PairingPanel busy={snapshot.phase === "pairing"} /><aside className="connection-notice" aria-live="polite">{snapshot.errorMessage ?? snapshot.statusMessage}</aside></main>;
  }

  return (
    <main className="desktop-shell" aria-label="Hermes desktop">
      <nav className="pane channels-pane" aria-labelledby="channels-heading">
        <header className="pane-header"><div><p className="eyebrow">Hermes</p><h1 id="channels-heading">Channels</h1></div><button type="button" aria-label="Create a channel" disabled>+</button></header>
        <div className="item-list">
          {snapshot.channels.length ? snapshot.channels.map((channel) => (
            <button type="button" className={channel.id === snapshot.selectedChannelId ? "list-item selected" : "list-item"} key={channel.id} onClick={() => void window.hermesDesktop.selectChannel(channel.id)}>
              <strong>{channel.name}</strong>{channel.description ? <span>{channel.description}</span> : null}
            </button>
          )) : <EmptyState>{snapshot.connectionState === "online" ? "No channels yet." : "Channels will appear when Hermes connects."}</EmptyState>}
        </div>
        <footer className="sidebar-footer"><button type="button" className="text-button" onClick={() => void window.hermesDesktop.forgetConnection()}>Forget connection</button></footer>
      </nav>

      <nav className="pane threads-pane" aria-labelledby="threads-heading">
        <header className="pane-header"><h2 id="threads-heading">Threads</h2><button type="button" aria-label="Create a topic" disabled>+</button></header>
        <div className="item-list">
          {snapshot.selectedChannelId ? snapshot.threads.length ? snapshot.threads.map((thread) => (
            <button type="button" className={thread.id === snapshot.selectedThreadId ? "list-item thread-item selected" : "list-item thread-item"} key={thread.id} onClick={() => void window.hermesDesktop.selectThread(thread.id)}>
              <strong>{thread.title}</strong>{thread.unreadCount ? <span className="unread-count">{thread.unreadCount}</span> : null}
            </button>
          )) : <EmptyState>No threads in this channel.</EmptyState> : <EmptyState>Choose a channel to see its threads.</EmptyState>}
        </div>
      </nav>

      <section className="pane conversation-pane" aria-labelledby="conversation-heading">
        <header className="conversation-header">
          <div><p className="eyebrow">Conversation</p><h2 id="conversation-heading">{snapshot.selectedThreadTitle ?? "Choose a thread"}</h2></div>
          <button type="button" className={`connection-state state-${snapshot.connectionState}`} onClick={() => void window.hermesDesktop.retryConnection()} title="Retry connection">{snapshot.connectionLabel}</button>
        </header>
        {snapshot.errorMessage ? <div className="error-banner" role="alert">{snapshot.errorMessage}</div> : null}
        {snapshot.selectedThreadId ? (
          <div className="message-list" aria-live="polite">
            {snapshot.messages.length ? snapshot.messages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}><p className="message-role">{message.role === "assistant" ? "Hermes" : message.role === "user" ? "You" : "Notice"}</p><div>{message.text}</div></article>
            )) : <div className="conversation-empty"><div className="empty-mark" aria-hidden="true">H</div><h3>No messages yet</h3><p>This conversation is ready when you are.</p></div>}
          </div>
        ) : <div className="conversation-empty"><div className="empty-mark" aria-hidden="true">H</div><h3>Your conversations will appear here</h3><p>Choose a thread to read its messages.</p></div>}
        <footer className="composer-placeholder" aria-label="Message composer"><textarea aria-label="Message" placeholder="Sending arrives in the next milestone" disabled /><button type="button" disabled>Send</button></footer>
      </section>
    </main>
  );
};

export const DesktopShell = () => <DesktopShellView snapshot={useDesktopSnapshot()} />;
