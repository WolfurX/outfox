/**
 * Wallet Standard relay (Solana), replacing the EIP-1193 relay wholesale — same
 * architecture: the client carries NO chain code and NO wallet library. Every
 * transaction is built server-side (chain.ts) and shipped down the wire as base64;
 * this module only discovers the browser's wallets and relays connect / signMessage /
 * signAndSendTransaction to them.
 *
 * The Wallet Standard is a window-event protocol (wallets self-register; no SDK
 * needed), implemented here directly. The Jupiter wallet kit was evaluated and
 * rejected 2026-08-28: it ships @coral-xyz/anchor, emotion, and react-query into the
 * bundle and its own modal UI — see SOLANA-FEASIBILITY.md §4.
 */

export class WalletError extends Error {}

export interface StdAccount {
  address: string; // base58
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
}

export interface StdWallet {
  version: string;
  name: string;
  /** data: URI icon, rendered as-is */
  icon: string;
  chains: readonly string[];
  features: Record<string, unknown>;
  accounts: readonly StdAccount[];
}

// The three features a wallet must offer to be usable here.
const CONNECT = 'standard:connect';
const SIGN_MSG = 'solana:signMessage';
const SIGN_SEND = 'solana:signAndSendTransaction';

const registry: StdWallet[] = [];

function add(w: StdWallet): void {
  if (!w?.features?.[CONNECT] || !w.features[SIGN_MSG] || !w.features[SIGN_SEND]) return;
  if (!registry.some((x) => x.name === w.name)) registry.push(w);
}

// App side of the protocol: catch wallets that register after this module loads, then
// announce readiness so wallets already on the page register with us.
const appApi = { register: (...ws: StdWallet[]) => { ws.forEach(add); return () => {}; } };
window.addEventListener('wallet-standard:register-wallet', (e) => {
  try { (e as CustomEvent<(api: typeof appApi) => void>).detail(appApi); } catch { /* wallet's bug */ }
});
window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: appApi }));

// Known-latent: the registry has no change subscription — surfaces see a wallet that
// registered after their render only because App's shared 1s tick re-renders the tree.
// If that tick ever goes away, give this module a subscribe() and use it in the picker.
export function wallets(): StdWallet[] {
  return [...registry];
}

export function hasWallet(): boolean {
  return registry.length > 0;
}

/** The wallet to use without asking: the remembered one if still present, else the
 * only one. null = several candidates and no memory — the surface shows the picker. */
export function pickWallet(): StdWallet | null {
  let name: string | null = null;
  try { name = localStorage.getItem('outfox.wallet'); } catch { /* private mode */ }
  const remembered = name ? registry.find((w) => w.name === name) : undefined;
  if (remembered) return remembered;
  return registry.length === 1 ? registry[0] : null;
}

export function rememberWallet(w: StdWallet): void {
  try { localStorage.setItem('outfox.wallet', w.name); } catch { /* private mode */ }
}

function feature<T>(w: StdWallet, name: string): T {
  const f = w.features[name];
  if (!f) throw new WalletError(`${w.name} does not support ${name}`);
  return f as T;
}

// The wallet's own message passes through verbatim — rewriting it (e.g. mapping
// anything with "cancelled" to "declined") would mask real causes like an expired
// blockhash. The Wallet Standard carries no error codes to switch on.
async function relay<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WalletError) throw e;
    throw new WalletError((e as Error).message || 'the wallet rejected the request');
  }
}

/** Connect and return the wallet's active Solana account (address is base58). */
export async function connect(w: StdWallet): Promise<StdAccount> {
  const f = feature<{ connect(): Promise<{ accounts: readonly StdAccount[] }> }>(w, CONNECT);
  const { accounts } = await relay(() => f.connect());
  const acct = accounts.find((a) => a.chains.some((c) => c.startsWith('solana:')));
  if (!acct) throw new WalletError('no Solana account in the wallet');
  return acct;
}

/** Sign a UTF-8 message with the account's key. Returns the base58 signature —
 * exactly what the server's verifiers (auth-siws, chain.ts link) expect. */
export async function signMessage(w: StdWallet, account: StdAccount, message: string): Promise<string> {
  const f = feature<{
    signMessage(...inputs: { account: StdAccount; message: Uint8Array }[]):
      Promise<readonly { signature: Uint8Array }[]>;
  }>(w, SIGN_MSG);
  const [out] = await relay(() => f.signMessage({ account, message: new TextEncoder().encode(message) }));
  if (!out?.signature) throw new WalletError('the wallet returned no signature');
  return base58(out.signature);
}

/** Voucher-domain chain ids (programs/settlement) → Wallet Standard chain names. */
const CHAINS: Record<number, string> = {
  0: 'solana:localnet',
  1: 'solana:devnet',
  2: 'solana:mainnet',
};

/** Relay a server-built transaction (base64, unsigned) for signing and submission on
 * the given chain. Returns the base58 transaction signature. */
export async function sendTx(
  w: StdWallet, account: StdAccount, txBase64: string, chainId: number,
): Promise<string> {
  const chain = CHAINS[chainId];
  if (!chain) throw new WalletError(`unknown chain id ${chainId}`);
  if (!w.chains.includes(chain)) {
    throw new WalletError(`${w.name} does not support the ${chain.slice('solana:'.length)} network`);
  }
  let transaction: Uint8Array;
  try {
    transaction = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
  } catch {
    throw new WalletError('the server sent an unreadable transaction');
  }
  const f = feature<{
    signAndSendTransaction(...inputs: { account: StdAccount; transaction: Uint8Array; chain: string }[]):
      Promise<readonly { signature: Uint8Array }[]>;
  }>(w, SIGN_SEND);
  const [out] = await relay(() => f.signAndSendTransaction({ account, transaction, chain }));
  if (!out?.signature) throw new WalletError('the wallet returned no signature');
  return base58(out.signature);
}

// Tiny base58 encoder (the one direction the client needs — signatures out).
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s;
}
