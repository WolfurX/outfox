/**
 * Injected-wallet helpers (EIP-1193), R2 external-wallet path only.
 *
 * Deliberately tiny: the client carries NO ABI code and NO chain library — every
 * transaction's calldata is encoded server-side (chain.ts) and shipped down the wire;
 * this module only relays it to whatever wallet the browser has. The production
 * embedded-account adapter (Privy, DESIGN-SYSTEM-WEB §10.2) replaces this file
 * wholesale; the rung model and the demanding-surface gates stay.
 */

interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export class WalletError extends Error {}

export function hasWallet(): boolean {
  return !!(window as { ethereum?: Eip1193 }).ethereum;
}

function provider(): Eip1193 {
  const eth = (window as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new WalletError('no wallet found in this browser');
  return eth;
}

async function req<T>(method: string, params?: unknown[]): Promise<T> {
  try {
    return await provider().request({ method, params }) as T;
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code === 4001) throw new WalletError('declined in the wallet');
    throw new WalletError((e as Error).message || 'the wallet rejected the request');
  }
}

/** Connect and return the active account (lowercase). */
export async function connect(): Promise<string> {
  const accounts = await req<string[]>('eth_requestAccounts');
  if (!accounts?.length) throw new WalletError('no account in the wallet');
  return accounts[0].toLowerCase();
}

/** personal_sign with explicit UTF-8 hex encoding (identical bytes in every wallet). */
export async function personalSign(address: string, message: string): Promise<string> {
  const hex = '0x' + Array.from(new TextEncoder().encode(message))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return req<string>('personal_sign', [hex, address]);
}

/** Ask the wallet to switch to the game's chain before any transaction. */
export async function ensureChain(chainId: number): Promise<void> {
  const current = await req<string>('eth_chainId');
  const want = '0x' + chainId.toString(16);
  if (current.toLowerCase() === want) return;
  try {
    await req('wallet_switchEthereumChain', [{ chainId: want }]);
  } catch (e) {
    if (e instanceof WalletError && /declined/.test(e.message)) throw e;
    throw new WalletError(`add chain ${chainId} to your wallet first, then retry`);
  }
}

/** Relay a server-encoded transaction. Returns the tx hash. */
export async function sendTx(tx: { from: string; to: string; data: string }): Promise<string> {
  return req<string>('eth_sendTransaction', [tx]);
}
