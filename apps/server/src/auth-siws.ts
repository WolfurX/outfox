/**
 * R1 production adapter: Sign In With Solana (SIWS-lite), replacing the Privy adapter
 * at the same seam (§10.2). The wallet proves control of its key by signing a
 * server-issued nonce; the proven pubkey becomes the verified subject
 * (`siws:<base58>`), flowing through the exact §10.1 collision semantics in
 * `engine.ts` — upgrade in place, never merge, never demote a rung.
 *
 * The sign-in message is deliberately DIFFERENT from the R2 wallet-link message
 * (`chain.ts::linkMessage`): a signature harvested for one purpose can never be
 * replayed for the other. Both are domain-bound and nonce-bound.
 */
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

/** The message the wallet signs to sign in. */
export function signInMessage(nonce: string, origin: string): string {
  return [
    `${origin} wants you to sign in to Outfox with this wallet.`,
    '',
    'Signing this proves you control the wallet. It does not move any funds',
    'and does not link the wallet for deposits or withdrawals.',
    '',
    `Nonce: ${nonce}`,
  ].join('\n');
}

/** Canonical verified subject for a wallet pubkey. Throws on garbage input. */
export function siwsSubject(address: string): string {
  return `siws:${new PublicKey(String(address)).toBase58()}`;
}

/** Verify the wallet's ed25519 signature over the sign-in message. `signature` is
 * base58 (wallet-standard signMessage output). */
export function verifySignIn(address: string, message: string, signature: string): boolean {
  try {
    return nacl.sign.detached.verify(
      Buffer.from(message, 'utf8'),
      bs58.decode(String(signature)),
      new PublicKey(String(address)).toBytes(),
    );
  } catch {
    return false;
  }
}
