// Adapt narrow service test doubles to explicit page ownership. Real transport
// concurrency is exercised by packages/client/tests/live-pages.test.mjs.
export function withPages(client) {
  const pages = new Map();
  client.acquirePage = id => {
    if (!pages.has(id)) {
      const page = Object.create(client);
      page.closeConversation = () => { client.messages.delete(id); };
      pages.set(id,page);
    }
    return pages.get(id);
  };
  client.page = id => pages.get(id);
  client.releasePage = id => { pages.delete(id); client.messages.delete(id); };
  return client;
}
