import { LiveSessionClient } from './liveClient';
import { ProtocolError, type Options, type Receipt, type Attachment, type Interaction, type LocalFile, type ChunkReader, type TransferProgress } from './index';
import type { LiveFrame } from './liveProtocol';
import type { OpenTimingObserver } from './openTiming';

/** One account connection/directory. Living pages own only content and scopes. */
export class LivePageClient extends LiveSessionClient {
  private readonly pageOptions: Options;
  private readonly pages = new Map<string, LiveSessionClient>();
  private selectedPage: string | null = null;
  private paused = false;
  private disposed = false;
  constructor(options: Options) {
    let self: LivePageClient | undefined;
    super({ ...options, onChange: () => { self?.directoryChanged(); options.onChange?.(); },
      onConnectionState: value => { for(const page of self?.pages.values() ?? []) page.sharedState(value); options.onConnectionState?.(value); } });
    self = this;
    this.pageOptions = options;
  }
  get openedPageIds(): readonly string[] { return [...this.pages.keys()]; }
  private directoryChanged(): void {
    if (this.isCatalogueReady) for (const [id,page] of [...this.pages]) {
      if (!this.isThreadAvailable(id)) this.releasePage(id,page);
    }
    this.mirror();
  }
  protected override connectionReady(frame: Extract<LiveFrame,{type:'hello'}>): void {
    if(!frame.multi_session_live)throw new ProtocolError('Server needs account session subscription support');
    super.connectionReady(frame);
    for(const page of this.pages.values())page.sharedConnected();
  }
  protected override scopedFrame(frame: Extract<LiveFrame,{type:'watching'|'conversation_changed'|'unavailable'}>): void {
    if(frame.thread_id)this.pages.get(frame.thread_id)?.receiveScopedFrame(frame);
    else super.scopedFrame(frame);
  }
  override failOpening(error: Error): void { super.failOpening(error); for(const page of this.pages.values())page.failOpening(error); }
  page(id: string): LiveSessionClient | undefined { return this.pages.get(id); }
  acquirePage(id: string): LiveSessionClient {
    if (this.disposed) throw new ProtocolError('Connection is closed');
    const existing = this.pages.get(id);
    if (existing) return existing;
    const page = new LiveSessionClient({ ...this.pageOptions,
      onChange: () => { if (this.pages.get(id) === page) { this.mirror(); this.pageOptions.onChange?.(); } },
      onConnectionState: undefined,
    },this);
    this.pages.set(id,page);
    if (this.paused) page.suspendConnection();
    return page;
  }
  releasePage(id: string, owner?: LiveSessionClient): void {
    const page = this.pages.get(id);
    if (!page || owner && owner !== page) return;
    this.pages.delete(id);
    if (this.selectedPage === id) this.selectedPage = null;
    page.close();
    this.mirror(); this.pageOptions.onChange?.();
  }
  private mirror(): void {
    // These are references to page-owned objects for outbox/IPC readers, not
    // another authority or another parsed history cache.
    this.messages.clear(); this.receipts.clear(); this.interactions.clear();
    this.attachments.clear(); this.drafts.clear(); this.tailIncomplete.clear();
    for (const [id,page] of this.pages) {
      const rows = page.messages.get(id);
      if (rows) this.messages.set(id,rows);
      for (const [key,value] of page.receipts) this.receipts.set(key,value);
      for (const [key,value] of page.interactions) this.interactions.set(key,value);
      for (const [key,value] of page.attachments) this.attachments.set(key,value);
      const draft = page.drafts.get(id); if (draft) this.drafts.set(id,draft);
      if (page.tailIncomplete.has(id)) this.tailIncomplete.add(id);
    }
  }
  override get currentThreadId(): string | null { return this.selectedPage; }
  override get currentConversationKey(): object { return this.currentPage()?.currentConversationKey ?? super.currentConversationKey; }
  override get currentOlderCursor(): string | null { return this.currentPage()?.currentOlderCursor ?? null; }
  override get currentNewerCursor(): string | null { return this.currentPage()?.currentNewerCursor ?? null; }
  private currentPage(): LiveSessionClient | undefined { return this.selectedPage ? this.pages.get(this.selectedPage) : undefined; }
  override openConversation(id: string, targetRef?: number, timing?: OpenTimingObserver, contentReady?:()=>void): Promise<void> {
    this.selectedPage = id;
    return this.acquirePage(id).openConversation(id,targetRef,timing,contentReady);
  }
  override closeConversation(): void { if (this.selectedPage) this.releasePage(this.selectedPage); }
  override async connect(): Promise<void> {
    this.disposed = false; this.paused = false;
    await super.connect();
  }
  override suspendConnection(): void {
    this.paused = true;
    for (const page of this.pages.values()) page.suspendConnection();
    super.suspendConnection();
  }
  override close(): void {
    this.disposed = true;
    const pages = [...this.pages.values()]; this.pages.clear(); this.selectedPage = null;
    for (const page of pages) page.close();
    super.close();
  }
  override rememberAcceptedInput(id: string, clientId: string, text: string, attachments: Attachment[], createdAt: number | undefined, receipt: Receipt): void {
    const page = this.pages.get(id);
    if (page) page.rememberAcceptedInput(id,clientId,text,attachments,createdAt,receipt);
    else super.rememberAcceptedInput(id,clientId,text,attachments,createdAt,receipt);
  }
  override async history(id: string, after?: string, limit=50, signal?: AbortSignal, afterRef?: number, ref?: number) {
    const page = this.pages.get(id);
    return page ? page.history(id,after,limit,signal,afterRef,ref) : super.history(id,after,limit,signal,afterRef,ref);
  }
  private requirePage(id: string): LiveSessionClient {
    const page = this.pages.get(id); if (!page) throw new ProtocolError('Conversation page is not alive'); return page;
  }
  override async historyWindow(id: string, before?: string, limit=30, signal?: AbortSignal) { return this.requirePage(id).historyWindow(id,before,limit,signal); }
  override async loadFullHistory(id: string, signal?: AbortSignal) { return this.requirePage(id).loadFullHistory(id,signal); }
  override async historyTail(id: string, signal?: AbortSignal) { return this.requirePage(id).historyTail(id,signal); }
  override async recoverHistoryTail(id: string, signal?: AbortSignal) { return this.requirePage(id).recoverHistoryTail(id,signal); }
  override async loadNewer(id: string) { return this.requirePage(id).loadNewer(id); }
  override async search(id: string,text: string,after?: string,limit=20,signal?: AbortSignal) { return this.requirePage(id).search(id,text,after,limit,signal); }
  override async getInteraction(id: string,key: string,signal?: AbortSignal) { return this.requirePage(id).getInteraction(id,key,signal); }
  override async answerInteraction(item: Interaction,choice: string) { return this.requirePage(item.thread_id).answerInteraction(item,choice); }
  override async getAttachment(id: string,key: string,signal?: AbortSignal) { return this.requirePage(id).getAttachment(id,key,signal); }
  override async download(id: string,key: string,signal?: AbortSignal) { return this.requirePage(id).download(id,key,signal); }
  override async downloadFile(id: string,key: string,destination: string,signal?: AbortSignal,onProgress?: TransferProgress) { return this.requirePage(id).downloadFile(id,key,destination,signal,onProgress); }
  override async uploadFile(id: string,name: string,file: LocalFile,signal?: AbortSignal) {
    return this.pages.get(id)?.uploadFile(id,name,file,signal) ?? super.uploadFile(id,name,file,signal);
  }
  override async uploadChunked(id: string,name: string,size: number,read: ChunkReader,signal?: AbortSignal,onProgress?: (sent: number,size: number) => void) {
    return this.pages.get(id)?.uploadChunked(id,name,size,read,signal,onProgress) ?? super.uploadChunked(id,name,size,read,signal,onProgress);
  }
  override async upload(id: string,name: string,bytes: Uint8Array,signal?: AbortSignal) {
    return this.pages.get(id)?.upload(id,name,bytes,signal) ?? super.upload(id,name,bytes,signal);
  }
  override async markResultRead(id: string,version: number,ref: number) { return this.pages.get(id)?.markResultRead(id,version,ref); }
}
