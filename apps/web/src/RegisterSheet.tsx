import { useState } from 'react';
import type { PlayerView } from '@outfox/shared';
import { api } from './api';
import { Banner, Button, Sheet } from './ds';
import { connect, rememberWallet, signMessage, type StdWallet } from './wallet';
import { WalletPicker } from './WalletPicker';

/**
 * R1 upgrade sheet (DESIGN-SYSTEM-WEB §10.1). Triggered by the demanding surface (a
 * gated market action), with the queued action auto-resumed on success. Handles the
 * credential-collision choose sheet: continue as the existing account (guest retired,
 * Scrip does not transfer) or cancel. Never silent overwrite/merge.
 *
 * Two adapters behind one sheet, chosen by the server's advertised auth.mode:
 *  - 'siws' (production on Solana): pick a wallet, sign the server's nonce message —
 *    signing proves control and moves no funds. Collision re-signs a FRESH nonce on
 *    adopt (nonces are single-use server-side).
 *  - 'dev' (chainless worlds and tests): email + one-time code, code shown inline.
 *
 * Copy rule (§10.1, amended by the Solana migration): registering IS the one wallet
 * ceremony at R1 now — name the wallet plainly, promise plainly that nothing moves.
 */
export function RegisterSheet(props: {
  mode: 'dev' | 'privy' | 'siws';
  reason: string;
  onDone: (player: PlayerView) => void;
  onAdopted: (player: PlayerView) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  // No Privy flow exists on the Solana track (SIWS replaced it at the same seam). A
  // server advertising it gets an honest refusal, not the dev sheet's dead end at
  // "Enter the code".
  if (props.mode === 'privy') {
    return (
      <Sheet title="Keep your take" onClose={props.onClose}
        footer={<Button variant="secondary" full onClick={props.onClose}>Close</Button>}>
        <p className="ofx-sheet__text">
          This world is set up for a sign-in this build does not carry. Registration is
          unavailable here for now.
        </p>
      </Sheet>
    );
  }

  return props.mode === 'siws'
    ? <SiwsBody {...props} busy={busy} error={error} run={run} />
    : <DevBody {...props} busy={busy} error={error} run={run} />;
}

type BodyProps = {
  reason: string;
  onDone: (player: PlayerView) => void;
  onAdopted: (player: PlayerView) => void;
  onClose: () => void;
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<void>) => Promise<void>;
};

// ----- SIWS: wallet sign-in ----------------------------------------------------

function SiwsBody({ reason, onDone, onAdopted, onClose, busy, error, run }: BodyProps) {
  const [step, setStep] = useState<'wallet' | 'collision'>('wallet');
  const [wallet, setWallet] = useState<StdWallet | null>(null);
  const [collisionAddr, setCollisionAddr] = useState('');
  const [collisionHandle, setCollisionHandle] = useState('');

  // One pass = connect, fetch a fresh nonce, sign, submit. Also the adopt path — the
  // first call consumed its nonce, so continuing as the existing Fox signs a new one;
  // the adopt pass is pinned to the account that collided, so switching accounts in
  // the wallet between the two passes cannot bind the session to a different Fox
  // than the one named on the button.
  const signIn = (w: StdWallet, adopt: boolean) => run(async () => {
    const account = await connect(w);
    if (adopt && account.address !== collisionAddr) {
      throw new Error(`That is a different account. Switch the wallet back to ${collisionAddr.slice(0, 4)}…${collisionAddr.slice(-4)} to continue as ${collisionHandle}.`);
    }
    const { nonce, message } = await api.siwsNonce();
    const signature = await signMessage(w, account, message);
    const r = await api.registerSiws(account.address, nonce, signature, adopt);
    rememberWallet(w);
    if (r.collision) {
      setWallet(w);
      setCollisionAddr(account.address);
      setCollisionHandle(r.collision.existingHandle);
      setStep('collision');
    } else if (r.player) {
      (adopt ? onAdopted : onDone)(r.player);
    }
  });

  const footer = step === 'wallet' ? (
    <Button variant="secondary" full onClick={onClose}>Cancel</Button>
  ) : (
    <>
      <Button disabled={busy} onClick={() => setStep('wallet')}>Different wallet</Button>
      <Button variant="primary" disabled={busy}
        onClick={() => wallet && signIn(wallet, true)}>
        Continue as {collisionHandle}
      </Button>
    </>
  );

  return (
    <Sheet
      title={step === 'wallet' ? 'Keep your take' : 'That wallet is already a Fox'}
      onClose={onClose} footer={footer}
    >
      {step === 'wallet' && (
        <>
          <p className="ofx-sheet__text">
            {reason} Your take lives on this device only until you sign in. Signing
            proves the wallet is yours — it moves no funds.
          </p>
          <WalletPicker busy={busy} onPick={(w) => signIn(w, false)} />
        </>
      )}
      {step === 'collision' && (
        <p className="ofx-sheet__text">
          This wallet belongs to {collisionHandle}. Continue as that Fox? This
          device&rsquo;s guest Scrip and items do not transfer.
        </p>
      )}
      {error && <Banner tone="danger" title="Rejected">{error}</Banner>}
    </Sheet>
  );
}

// ----- dev: email + one-time code ----------------------------------------------

function DevBody({ reason, onDone, onAdopted, onClose, busy, error, run }: BodyProps) {
  const [step, setStep] = useState<'email' | 'code' | 'collision'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [collisionHandle, setCollisionHandle] = useState('');

  const title = step === 'email' ? 'Keep your take'
    : step === 'code' ? 'Enter the code'
      : 'That email is already a Fox';

  const footer = step === 'email' ? (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button
        variant="primary"
        disabled={busy || !email}
        onClick={() => run(async () => {
          const r = await api.registerStart(email);
          setDevCode(r.devCode ?? null);
          setStep('code');
        })}
      >
        Send code
      </Button>
    </>
  ) : step === 'code' ? (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button
        variant="primary"
        disabled={busy || code.length < 6}
        onClick={() => run(async () => {
          const r = await api.registerVerify(email, code);
          if (r.collision) { setCollisionHandle(r.collision.existingHandle); setStep('collision'); }
          else if (r.player) onDone(r.player);
        })}
      >
        Verify
      </Button>
    </>
  ) : (
    <>
      <Button disabled={busy} onClick={() => { setStep('email'); setCode(''); }}>
        Different email
      </Button>
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => run(async () => {
          const r = await api.registerAdopt(email);
          if (r.player) onAdopted(r.player);
        })}
      >
        Continue as {collisionHandle}
      </Button>
    </>
  );

  return (
    <Sheet title={title} onClose={onClose} footer={footer}>
      {step === 'email' && (
        <>
          <p className="ofx-sheet__text">
            {reason} Your take lives on this device only until you register.
          </p>
          <label className="ofx-sheet__field">
            <span className="ofx-sheet__label">Email</span>
            <input
              className="ofx-input ofx-input--wide"
              type="email"
              inputMode="email"
              placeholder="you@email.com"
              value={email}
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </>
      )}

      {step === 'code' && (
        <>
          <p className="ofx-sheet__text">
            Sent to {email}.{devCode ? ` Dev code: ${devCode}` : ''}
          </p>
          <label className="ofx-sheet__field">
            <span className="ofx-sheet__label">Six-digit code</span>
            <input
              className="ofx-input ofx-input--wide"
              inputMode="numeric"
              placeholder="000000"
              value={code}
              autoFocus
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
            />
          </label>
        </>
      )}

      {step === 'collision' && (
        <p className="ofx-sheet__text">
          {email} belongs to {collisionHandle}. Continue as that Fox? This device&rsquo;s
          guest Scrip and items do not transfer.
        </p>
      )}

      {error && <Banner tone="danger" title="Rejected">{error}</Banner>}
    </Sheet>
  );
}
