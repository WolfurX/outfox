import type {
  BootstrapResponse, ActionResponse, MarketResponse, LedgerResponse,
  RegisterStartResponse, RegisterVerifyResponse, ExchangeResponse,
  ExchangeHistoryResponse, AlphaResponse, ClaimResponse, DepositPrepareResponse,
  PlayerView, AlphaView, WithdrawalView,
} from '@outfox/shared';

/** Parse a response defensively: a non-JSON body (gateway 502 HTML, dead proxy) is a
 * NETWORK-class failure — surface it as TypeError so the app shows TAPE HALTED, not a
 * raw JSON parse error in the banner. */
export class ApiError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function parse<T>(res: Response): Promise<T> {
  let data: { error?: string; code?: string } = {};
  try {
    data = await res.json();
  } catch {
    throw new TypeError(`upstream returned non-JSON (${res.status})`);
  }
  if (!res.ok) throw new ApiError(data.error ?? `request failed (${res.status})`, data.code);
  return data as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return parse<T>(res);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' });
  return parse<T>(res);
}

// NOTE: money renders via icons.tsx (ScripAmount / ScripMark) — the Scrip mark is a §6
// SVG brand glyph, never a text symbol. No string-based currency formatting here.
export const api = {
  bootstrap: () => post<BootstrapResponse>('/api/session/bootstrap'),
  call: (callId: string) => post<ActionResponse>('/api/actions/call', { callId }),
  gig: () => post<ActionResponse>('/api/actions/gig'),
  refill: (bar: 'focus' | 'risk') => post<ActionResponse>('/api/sinks/refill', { bar }),
  market: () => get<MarketResponse>('/api/market'),
  list: (itemId: number, price: number) => post<MarketResponse>('/api/market/list', { itemId, price }),
  cancel: (listingId: number) => post<MarketResponse>('/api/market/cancel', { listingId }),
  buy: (listingId: number) => post<MarketResponse>('/api/market/buy', { listingId }),
  ledger: () => get<LedgerResponse>('/api/ledger'),
  registerStart: (email: string) => post<RegisterStartResponse>('/api/register/start', { email }),
  registerVerify: (email: string, code: string) =>
    post<RegisterVerifyResponse>('/api/register/verify', { email, code }),
  registerAdopt: (email: string) => post<MarketResponse>('/api/register/adopt', { email }),

  // R1 production adapter (SIWS): nonce challenge, then the signed message registers —
  // or, with adopt, rebinds the session to the colliding account (fresh nonce each call).
  siwsNonce: () => post<{ nonce: string; message: string }>('/api/register/siws/nonce'),
  registerSiws: (address: string, nonce: string, signature: string, adopt?: boolean) =>
    post<RegisterVerifyResponse>('/api/register/siws', { address, nonce, signature, adopt }),

  // ----- the Clearinghouse (exchange + chain edge) -----
  exchange: () => get<ExchangeResponse>('/api/exchange'),
  exchangeHistory: () => get<ExchangeHistoryResponse>('/api/exchange/history'),
  exchangeQuote: (side: 'buy' | 'sell', amount: string) =>
    post<ExchangeResponse>('/api/exchange/quote', { side, amount }),
  exchangeSwap: (side: 'buy' | 'sell', amount: string, minOut: string) =>
    post<ExchangeResponse>('/api/exchange/swap', { side, amount, minOut }),
  alpha: () => get<AlphaResponse>('/api/alpha'),
  walletNonce: () => post<{ nonce: string; message: string }>('/api/wallet/nonce'),
  walletLink: (address: string, nonce: string, signature: string) =>
    post<{ player: PlayerView; alpha: AlphaView }>('/api/wallet/link', { address, nonce, signature }),
  verifyDev: () => post<{ player: PlayerView }>('/api/verify/dev'),
  withdrawRequest: (amountWei: string) =>
    post<{ withdrawal: WithdrawalView; alpha: AlphaView }>('/api/withdraw/request', { amountWei }),
  withdrawClaim: (id: number) => post<ClaimResponse>('/api/withdraw/claim', { id }),
  depositPrepare: (amountWei: string, from: string) =>
    post<DepositPrepareResponse>('/api/deposit/prepare', { amountWei, from }),
};
