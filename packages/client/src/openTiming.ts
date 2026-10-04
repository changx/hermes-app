/** Temporary, opt-in observation. Payload contains no identifiers or content. */
export type OpenTimingStage = 'open-start' | 'watch-ready' | 'history-start' | 'history-ready' | 'state-start' | 'state-ready' | 'open-ready' | 'cancelled';
export type OpenRequestKind = 'capabilities' | 'catalogue' | 'history' | 'state';
export type OpenTimingEvent = { stage: OpenTimingStage; rows?: number } | { request: OpenRequestKind; edge: 'start' | 'end'; sequence: number };
export type OpenTimingObserver = (event: OpenTimingEvent) => void;
