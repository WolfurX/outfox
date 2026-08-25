// WCAG AA contrast verification for the ported Outfox tokens, both themes.
// The design system CLAIMS "every pair is WCAG AA in both themes" — verify, don't trust.
const P = {
  ink950:'#0B0E14', ink900:'#11151F', ink850:'#161B26', ink800:'#1C2230',
  ink700:'#232A3A', ink600:'#333D52', ink500:'#55607A', ink400:'#8A93A8',
  ink300:'#ABB4C6', ink100:'#E6EAF2',
  paper100:'#FFFFFF', paper200:'#F4F6FA', paper300:'#E9EDF4', paper400:'#D5DBE7',
  paper500:'#BFC8D8', paperInk:'#171C26',
  fox300:'#FFB077', fox400:'#FF8A3D', fox500:'#F1731C', fox600:'#B25307', fox950:'#1A0D02',
  red400:'#FF5C5C', red600:'#C13A3A', green400:'#3DD68C', green600:'#1D7A4F',
  amber400:'#FFC24B', amber700:'#8A6100', haze400:'#9DA8F5', haze600:'#4C58C4',
};
const lin = c => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const L = hex => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126*lin(n>>16&255) + 0.7152*lin(n>>8&255) + 0.0722*lin(n&255);
};
const ratio = (a, b) => { const [x,y] = [L(a), L(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };

// [label, fg, bg, minimum]  — 4.5 normal text, 3.0 large text (>=24px) and UI borders
const dark = [
  ['text on bg',            P.ink100, P.ink950, 4.5],
  ['text on surface',       P.ink100, P.ink900, 4.5],
  ['text on panel',         P.ink100, P.ink850, 4.5],
  ['text-2 (hint) on bg',   P.ink400, P.ink950, 4.5],
  ['text-2 on surface',     P.ink400, P.ink900, 4.5],
  ['text-2 on panel',       P.ink400, P.ink850, 4.5],
  ['accent as text on bg',  P.fox400, P.ink950, 4.5],
  ['accent as text on surf',P.fox400, P.ink900, 4.5],
  ['on-accent (fill text)', P.fox950, P.fox400, 4.5],
  ['up/gain on surface',    P.green400, P.ink900, 4.5],
  ['down/loss on surface',  P.red400, P.ink900, 4.5],
  ['warn on surface',       P.amber400, P.ink900, 4.5],
  ['UNSETTLED on surface',  P.haze400, P.ink900, 4.5],
  ['border vs surface',     P.ink700, P.ink900, 1.0],   // hairline: decorative
  ['focus ring on bg',      P.fox300, P.ink950, 3.0],   // UI component
];
const light = [
  ['text on bg',            P.paperInk, P.paper200, 4.5],
  ['text on surface',       P.paperInk, P.paper100, 4.5],
  ['text-3 (disabled)',     P.paper500, P.paper100, 1.0], // disabled: exempt
  ['accent as text on bg',  P.fox600, P.paper200, 4.5],
  ['accent as text on surf',P.fox600, P.paper100, 4.5],
  ['on-accent (fill text)', P.fox950, P.fox500, 4.5],
  ['up/gain on surface',    P.green600, P.paper100, 4.5],
  ['down/loss on surface',  P.red600, P.paper100, 4.5],
  ['warn on surface',       P.amber700, P.paper100, 4.5],
  ['UNSETTLED on surface',  P.haze600, P.paper100, 4.5],
  ['focus ring on bg',      P.fox600, P.paper200, 3.0],
];
let fails = 0;
for (const [name, rows] of [['DARK (canonical)', dark], ['LIGHT (daylight session)', light]]) {
  console.log(`\n=== ${name} ===`);
  for (const [label, fg, bg, min] of rows) {
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) fails++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(6)}:1  (needs ${min})  ${label}`);
  }
}
// text-2 in light is a color-mix — approximate it: 62% ink over paper-200
const mix = (a, b, pct) => {
  const A = parseInt(a.slice(1),16), B = parseInt(b.slice(1),16);
  const ch = (s) => Math.round(((A>>s&255)*pct + (B>>s&255)*(1-pct)));
  return '#' + [16,8,0].map(s=>ch(s).toString(16).padStart(2,'0')).join('');
};
const t2light = mix(P.paperInk, P.paper200, 0.62);
const r2 = ratio(t2light, P.paper100);
console.log(`\n  ${r2>=4.5?'PASS':'FAIL'}  ${r2.toFixed(2)}:1  (needs 4.5)  text-2 (color-mix ~${t2light}) on surface [LIGHT]`);
if (r2 < 4.5) fails++;
console.log(`\n${fails ? `${fails} PAIR(S) BELOW AA` : 'ALL PAIRS MEET WCAG AA'}`);
process.exitCode = fails ? 1 : 0;
