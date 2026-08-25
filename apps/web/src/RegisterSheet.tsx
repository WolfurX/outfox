import { useState } from 'react';
import type { PlayerView } from '@outfox/shared';
import { api } from './api';
import { Banner, Button, Sheet } from './ds';

/**
 * R1 upgrade sheet (DESIGN-SYSTEM-WEB §10.1). Triggered by the demanding surface (a
 * gated market action), with the queued action auto-resumed on success. Handles the
 * credential-collision choose sheet: continue as the existing account (guest retired,
 * Scrip does not transfer) or cancel. Never silent overwrite/merge.
 *
 * Slice auth adapter: email + one-time code. In dev the code is shown inline; production
 * swaps this whole component for the Privy embedded-wallet flow.
 *
 * Copy rule (§10.1): no wallet jargon at R0/R1 — never "wallet", "keys", "sign",
 * "on-chain". The account is "your Book".
 */
export function RegisterSheet(props: {
  reason: string;
  onDone: (player: PlayerView) => void;
  onAdopted: (player: PlayerView) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'email' | 'code' | 'collision'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [collisionHandle, setCollisionHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const title = step === 'email' ? 'Keep your take'
    : step === 'code' ? 'Enter the code'
      : 'That email is already a Fox';

  const footer = step === 'email' ? (
    <>
      <Button onClick={props.onClose}>Cancel</Button>
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
      <Button onClick={props.onClose}>Cancel</Button>
      <Button
        variant="primary"
        disabled={busy || code.length < 6}
        onClick={() => run(async () => {
          const r = await api.registerVerify(email, code);
          if (r.collision) { setCollisionHandle(r.collision.existingHandle); setStep('collision'); }
          else if (r.player) props.onDone(r.player);
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
          if (r.player) props.onAdopted(r.player);
        })}
      >
        Continue as {collisionHandle}
      </Button>
    </>
  );

  return (
    <Sheet title={title} onClose={props.onClose} footer={footer}>
      {step === 'email' && (
        <>
          <p className="ofx-sheet__text">
            {props.reason} Your take lives on this device only until you register.
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
