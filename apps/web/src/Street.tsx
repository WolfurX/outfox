import { ChevronRight } from 'lucide-react';
import { Chip, ListRow, RowGroup } from './ds';

/**
 * The Street (DESIGN-SYSTEM-WEB §2.4): one row per district, menu/stat-based, never a
 * rendered map. A district is OPEN when the mechanic behind it exists in this build and
 * its row is the entry point; otherwise it is CLOSED — emblem, name, one line of fiction,
 * no tap target, no date, no promise. No district carries a rung gate: §10.1 unlocks
 * Calls, Raids, Gigs and The Sim at R0; deposits and cash-out gate inside the
 * Clearinghouse itself. District-to-system assignment follows the published whitepaper
 * (whitepaper/the-game/the-street.md; owner ruling 2026-09-12): The Floor is Gigs and
 * Options Alley is Calls, both of which live on The Tape, so both rows enter there.
 */
export type DistrictEntry = 'tape' | 'clearinghouse';

const DISTRICTS: { id: string; name: string; line: string; entry?: DistrictEntry }[] = [
  { id: 'floor', name: 'The Floor', line: 'Gigs. Honest work, reliable pay.', entry: 'tape' },
  { id: 'options_alley', name: 'Options Alley', line: 'Calls against the market. Open outcry, all day.', entry: 'tape' },
  { id: 'pit', name: 'The Pit', line: 'Raids on the Houses. The Sheriff watches this one.' },
  { id: 'dark_pool', name: 'The Dark Pool', line: 'The quiet end of the market.' },
  {
    id: 'vault', name: 'The Vault', entry: 'clearinghouse',
    line: 'The Clearinghouse. Swap Scrip and $ALPHA, deposit, cash out.',
  },
  { id: 'after_hours', name: 'After Hours', line: 'The endgame district. The Street never closes.' },
  { id: 'hollow', name: 'The Hollow', line: 'The crews’ quarter. Skulks and the Commons.' },
];

export function Street({ onEnter }: { onEnter: (entry: DistrictEntry) => void }) {
  return (
    <RowGroup title="The Street — seven districts">
      {DISTRICTS.map((d) => {
        const entry = d.entry;
        return (
          <ListRow
            key={d.id}
            lead={
              <img
                className={entry ? 'ofx-emblem' : 'ofx-emblem ofx-emblem--closed'}
                src={`/art/emblem-${d.id}.webp`} alt="" loading="lazy" decoding="async"
              />
            }
            title={d.name}
            sub={d.line}
            trail={entry
              ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Chip tone="up">Open</Chip>
                  <ChevronRight size={16} strokeWidth={1.75} />
                </span>
              )
              : <Chip>Closed</Chip>}
            onPress={entry ? () => onEnter(entry) : undefined}
          />
        );
      })}
    </RowGroup>
  );
}
