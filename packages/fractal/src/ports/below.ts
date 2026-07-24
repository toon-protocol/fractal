/**
 * The only port that reaches the operator's real-world APIs, and strictly
 * read-only (CONTEXT.md — Hermetic framing, Ascent). Real HTTP calls live
 * behind implementations of this interface; nothing outside a Below port
 * implementation may fetch the network.
 */
export interface BelowRequest {
  readonly sourceId: string;
  readonly resource: string;
}

export interface BelowResponse {
  readonly sourceId: string;
  readonly resource: string;
  readonly fetchedAt: string;
  readonly payload: unknown;
}

export interface BelowPort {
  fetch(request: BelowRequest): Promise<BelowResponse>;
}
