// Sidebar Session card page. Main calls `showCard` with plain text; this page has no preload and no IPC.
// Text goes in through textContent only, never as HTML.
type Card = { title: string; project?: string; connection?: string; statuses: string[]; labels: string[]; lastMessage?: string; fontSize: number; width: number };

const line = (className: string, text: string): HTMLDivElement => {
  const element = document.createElement('div');
  element.className = className; element.textContent = text;
  return element;
};

/** Renders the card at the given width and returns its height in CSS pixels. */
function showCard(card: Card): number {
  const root = document.getElementById('card')!;
  root.style.width = `${card.width}px`;
  root.style.fontSize = `${card.fontSize}px`;
  const parts: HTMLElement[] = [line('title', card.title)];
  const where = [card.project, card.connection].filter(Boolean).join(' · ');
  if (where) parts.push(line('meta', where));
  if (card.statuses.length) parts.push(line('status', card.statuses.join(' · ')));
  if (card.labels.length) {
    const labels = document.createElement('div');
    labels.className = 'labels';
    for (const label of card.labels) labels.append(Object.assign(document.createElement('span'), { className: 'label', textContent: label }));
    parts.push(labels);
  }
  if (card.lastMessage) parts.push(line('meta', `Last message ${card.lastMessage}`));
  root.replaceChildren(...parts);
  return Math.ceil(root.getBoundingClientRect().height);
}

(window as unknown as { showCard: typeof showCard }).showCard = showCard;
