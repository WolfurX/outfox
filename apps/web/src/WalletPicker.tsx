import { Wallet as WalletIcon } from 'lucide-react';
import { EmptyState, ListRow } from './ds';
import { wallets, type StdWallet } from './wallet';

/**
 * The list of detected Wallet Standard wallets, one pressable row each. Shared by the
 * SIWS register sheet and the Clearinghouse wallet flows — the two surfaces where a
 * wallet must be chosen. The wallet's own icon is product identity, not decoration.
 */
export function WalletPicker({ onPick, busy }: {
  onPick: (w: StdWallet) => void; busy?: boolean;
}) {
  const ws = wallets();
  if (ws.length === 0) {
    return (
      <EmptyState
        icon={<WalletIcon size={20} strokeWidth={1.5} />}
        title="No Solana wallet in this browser"
        hint="Install one, then come back — this page will see it."
      />
    );
  }
  return (
    <>
      {ws.map((w) => (
        <ListRow
          key={w.name}
          lead={w.icon.startsWith('data:image/')
            // a data: icon is self-contained; anything else would be a remote fetch
            // from inside a custody surface — fall back to the neutral mark instead
            ? <img src={w.icon} alt="" width={18} height={18} style={{ borderRadius: 4, display: 'block' }} />
            : <WalletIcon size={18} strokeWidth={1.75} />}
          title={w.name}
          disabled={busy}
          onPress={() => onPick(w)}
        />
      ))}
    </>
  );
}
