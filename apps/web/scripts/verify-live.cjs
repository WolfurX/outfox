/* Live client verification (Solana migration step 4): SIWS register/adopt, R2 link,
 * deposit guards, dev-sheet regression — against a real server (siws mode, chainless,
 * seeded exchange) and the BUILT web bundle (run `npm run build` first) via vite
 * preview, in a headless Chromium-family browser with a stub Wallet Standard wallet
 * whose keys live here in node (signing bridged via exposeFunction).
 *
 * Usage: node apps/web/scripts/verify-live.cjs
 * Env: OUTFOX_BROWSER (default /usr/bin/brave), OUTFOX_VERIFY_PORT_API (18787),
 *      OUTFOX_VERIFY_PORT_WEB (15173). World A runs under the id-ID locale — the
 *      dot-grouping locale that broke the pre-review Max/clamp round-trip. */
const { chromium } = require('playwright-core');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default;
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../../..');
const BROWSER = process.env.OUTFOX_BROWSER || '/usr/bin/brave';
const PORT_API = Number(process.env.OUTFOX_VERIFY_PORT_API || 18787);
const PORT_WEB = Number(process.env.OUTFOX_VERIFY_PORT_WEB || 15173);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'outfox-verify-'));
const DB = path.join(WORK, 'outfox-live.sqlite');
const PREVIEW_CONFIG = path.join(WORK, 'vite.preview.mjs');
fs.writeFileSync(PREVIEW_CONFIG, `export default {
  root: ${JSON.stringify(path.join(REPO, 'apps/web'))},
  preview: { host: '127.0.0.1', port: ${PORT_WEB}, proxy: { '/api': 'http://127.0.0.1:${PORT_API}' } },
};\n`);

// The Wire's Panta stand-in: the server test fixture, anchored at T0 = 1.8e9 s (the route
// test fakes Date there). This server runs on the real clock, so world F's copy is shifted
// to now; the listing rule and quote freshness then hold exactly as they do at T0.
const WIRE_FIXTURE_SRC = path.join(REPO, 'apps/server/test/fixtures/wire/market-world.json');
const WIRE_FIXTURE = path.join(WORK, 'wire-fixture.json');
function writeWireFixture() {
  const f = JSON.parse(fs.readFileSync(WIRE_FIXTURE_SRC, 'utf8'));
  const shift = Math.floor(Date.now() / 1000) - 1_800_000_000;
  for (const m of f.markets) {
    for (const k of ['startTime', 'endTime', 'resolutionTime']) if (typeof m[k] === 'number') m[k] += shift;
  }
  fs.writeFileSync(WIRE_FIXTURE, JSON.stringify(f));
}

const kp = nacl.sign.keyPair();
const ADDRESS = bs58.encode(Buffer.from(kp.publicKey));
const altKp = nacl.sign.keyPair();
const ALT_ADDRESS = bs58.encode(Buffer.from(altKp.publicKey));

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}`); }
}

async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error(`not up: ${url}`);
}

function startServer(extraEnv = {}) {
  const p = spawn('npx', ['tsx', 'apps/server/src/index.ts'], {
    cwd: REPO,
    env: {
      ...process.env, OUTFOX_DB: DB, OUTFOX_DEV_SEED_EXCHANGE: '1', PORT: String(PORT_API), ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', () => {});
  p.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return p;
}

const INIT = `(() => {
  try { localStorage.setItem('outfox.ftue', 'done'); } catch {}
  const account = {
    address: ${JSON.stringify(ADDRESS)},
    publicKey: Uint8Array.from(atob(${JSON.stringify(Buffer.from(kp.publicKey).toString('base64'))}), c => c.charCodeAt(0)),
    chains: ['solana:localnet','solana:devnet','solana:mainnet'],
    features: ['solana:signMessage','solana:signAndSendTransaction'],
  };
  const altAccount = {
    address: ${JSON.stringify(ALT_ADDRESS)},
    publicKey: Uint8Array.from(atob(${JSON.stringify(Buffer.from(altKp.publicKey).toString('base64'))}), c => c.charCodeAt(0)),
    chains: ['solana:localnet','solana:devnet','solana:mainnet'],
    features: ['solana:signMessage','solana:signAndSendTransaction'],
  };
  const wallet = {
    version: '1.0.0',
    name: 'TestFox',
    icon: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#e86a2b"/></svg>'),
    chains: ['solana:localnet','solana:devnet','solana:mainnet'],
    accounts: [account],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [window.__stubUseAlt ? altAccount : account] }) },
      'solana:signMessage': { version: '1.0.0', signMessage: async (...inputs) => {
        const out = [];
        for (const inp of inputs) {
          const b64 = btoa(String.fromCharCode(...inp.message));
          const sigB64 = await window.__stubSign(b64);
          out.push({ signedMessage: inp.message, signature: Uint8Array.from(atob(sigB64), c => c.charCodeAt(0)) });
        }
        return out;
      } },
      'solana:signAndSendTransaction': { version: '1.0.0', signAndSendTransaction: async () => {
        throw new Error('no chain in this test world');
      } },
    },
  };
  const cb = (api) => { try { api.register(wallet); } catch {} };
  window.addEventListener('wallet-standard:app-ready', (e) => cb(e.detail));
  try { window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: cb })); } catch {}
})()`;

async function newWorld(browser, opts = {}) {
  const ctx = await browser.newContext(opts);
  await ctx.exposeFunction('__stubSign', (b64) => {
    const sig = nacl.sign.detached(Buffer.from(b64, 'base64'), kp.secretKey);
    return Buffer.from(sig).toString('base64');
  });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 400/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

async function farmAndOpenExchange(page) {
  await page.goto(`http://127.0.0.1:${PORT_WEB}/`);
  await page.getByText('Run the Tape').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Work it' }).click();
  await page.getByText('Settled +90 Scrip').first().waitFor({ timeout: 5000 });
  await page.getByText('Ledger', { exact: true }).first().click();
  await page.getByText('The Clearinghouse').first().click();
  await page.getByPlaceholder('Scrip to spend').waitFor({ timeout: 5000 });
  await page.getByPlaceholder('Scrip to spend').fill('50');
  const review = page.getByRole('button', { name: 'Review the swap' });
  await page.waitForFunction(
    () => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Review the swap')); return b && !b.disabled; },
    { timeout: 5000 },
  );
  await review.click();
  await page.getByRole('button', { name: 'Swap', exact: true }).click();
  // guest → rung_required → the SIWS sheet
  await page.getByText('Keep your take').waitFor({ timeout: 5000 });
}

(async () => {
  fs.rmSync(DB, { force: true });
  let server = startServer(); // no OUTFOX_DEV_AUTH, no chain → auth.mode 'siws', chainless
  const preview = spawn('npx', ['vite', 'preview', '--config', PREVIEW_CONFIG], {
    cwd: `${REPO}/apps/web`, env: process.env, stdio: ['ignore', 'ignore', 'pipe'],
  });
  preview.stderr.on('data', () => {});
  const cleanup = () => { try { server.kill(); } catch {} try { preview.kill(); } catch {} };
  process.on('exit', cleanup);

  try {
    await waitHttp(`http://127.0.0.1:${PORT_API}/api/market`); // 401 json still resolves
    await waitHttp(`http://127.0.0.1:${PORT_WEB}/`);

    const browser = await chromium.launch({ executablePath: BROWSER, headless: true });

    // ---- world A: SIWS register via demanding surface, resume, then R2 link ----
    const A = await newWorld(browser, { locale: 'id-ID' });
    await farmAndOpenExchange(A.page);
    ok('A1 siws sheet shows the detected wallet', await A.page.getByText('TestFox').isVisible());
    await A.page.getByText('TestFox').click();
    // register succeeds, sheet closes, gated swap resumes
    await A.page.getByText('Keep your take').waitFor({ state: 'detached', timeout: 8000 });
    ok('A2 sheet closed after wallet sign-in', true);
    const handle = (await A.page.locator('header b').innerText()).trim();
    // resumed swap spent 50 of 90 settled scrip
    await A.page.getByRole('button', { name: '[ Ledger ]' }).click(); // back to Ledger
    await A.page.getByText('exchange_buy').first().waitFor({ timeout: 8000 });
    const ledgerText = await A.page.locator('main').innerText();
    ok('A3 gated swap auto-resumed after register (90 → 40 settled)',
      /40Scrip/.test(ledgerText.replace(/\s+/g, '')) && ledgerText.includes('-50'));
    // back into the Clearinghouse: R2 link
    await A.page.getByText('The Clearinghouse').first().click();
    await A.page.getByRole('button', { name: 'Link', exact: true }).click();
    await A.page.getByText('Verify once').waitFor({ timeout: 8000 });
    ok('A4 wallet linked via signMessage (rung 2, verify row shown)', true);
    ok('A5 deposit surface appeared at rung 2',
      await A.page.getByPlaceholder('$ALPHA to deposit').isVisible());
    // chainless deposit fails closed with the server's honest reason
    await A.page.getByPlaceholder('$ALPHA to deposit').fill('1');
    await A.page.getByRole('button', { name: 'Deposit', exact: true }).click();
    await A.page.getByText('the chain edge is not configured').waitFor({ timeout: 8000 });
    ok('A6 chainless deposit surfaces the honest chain-off reason', true);
    // F1 regression: a connected account that is not the linked wallet is refused
    await A.page.evaluate(() => { window.__stubUseAlt = true; });
    await A.page.getByRole('button', { name: 'Deposit', exact: true }).click();
    await A.page.getByText('deposits from other wallets cannot reach your Book').waitFor({ timeout: 8000 });
    ok('A6b deposit from a non-linked account fails closed', true);
    await A.page.evaluate(() => { window.__stubUseAlt = false; });
    // persistence
    await A.page.reload();
    await A.page.getByText('Run the Tape').first().waitFor({ timeout: 10000 });
    await A.page.getByText('Ledger', { exact: true }).first().click();
    await A.page.getByText('The Clearinghouse').first().click();
    await A.page.getByText('Verify once').waitFor({ timeout: 8000 });
    ok('A7 rung + link survive reload', true);
    ok('A8 zero console errors in world A', A.errors.length === 0);
    if (A.errors.length) console.log('   errors:', A.errors.slice(0, 5));
    await A.ctx.close();

    // ---- world B: same wallet, fresh guest → collision → adopt ----
    const B = await newWorld(browser);
    await farmAndOpenExchange(B.page);
    await B.page.getByText('TestFox').click();
    await B.page.getByText('That wallet is already a Fox').waitFor({ timeout: 8000 });
    ok('B1 collision sheet on second guest with same wallet', true);
    await B.page.getByRole('button', { name: `Continue as ${handle}` }).click();
    await B.page.getByText('That wallet is already a Fox').waitFor({ state: 'detached', timeout: 8000 });
    const handleB = (await B.page.locator('header b').innerText()).trim();
    ok(`B2 adopt rebinds the session to ${handle}`, handleB === handle);
    ok('B3 zero console errors in world B', B.errors.length === 0);
    if (B.errors.length) console.log('   errors:', B.errors.slice(0, 5));
    await B.ctx.close();

    // ---- world C: dev-mode regression — the email sheet still drives ----
    server.kill();
    await new Promise((r) => setTimeout(r, 500));
    server = startServer({ OUTFOX_DEV_AUTH: '1' });
    await waitHttp(`http://127.0.0.1:${PORT_API}/api/market`);
    const C = await newWorld(browser);
    await farmAndOpenExchange(C.page);
    ok('C1 dev mode still shows the email sheet',
      await C.page.getByPlaceholder('you@email.com').isVisible());
    ok('C2 zero console errors in world C', C.errors.length === 0);
    await C.ctx.close();

    // ---- world D: The Street — seven districts, three open with entry points (The Floor
    // = Gigs and Options Alley = Calls both enter The Tape; The Vault enters the
    // Clearinghouse), the rest closed and not pressable (no rung gate on any district;
    // DESIGN-SYSTEM-WEB §2.4; assignment per whitepaper/the-game/the-street.md) ----
    const D = await newWorld(browser);
    await D.page.goto(`http://127.0.0.1:${PORT_WEB}/`);
    await D.page.getByText('Your Book').first().waitFor({ timeout: 10000 });
    await D.page.getByText('The Street', { exact: true }).first().click();
    await D.page.getByText('The Hollow').waitFor({ timeout: 5000 });
    ok('D1 seven districts listed', await D.page.locator('.ofx-emblem').count() === 7);
    ok('D2 three open districts pressable, four closed and inert',
      await D.page.locator('.ofx-row--press').count() === 3
      && await D.page.getByText('Closed', { exact: true }).count() === 4);
    await D.page.getByRole('button', { name: /The Vault/ }).click();
    await D.page.getByPlaceholder('Scrip to spend').waitFor({ timeout: 5000 });
    ok('D3 The Vault opens the Clearinghouse', true);
    await D.page.getByText('The Street', { exact: true }).first().click();
    await D.page.getByRole('button', { name: /The Floor/ }).click();
    await D.page.getByText('Gigs — honest work').waitFor({ timeout: 5000 });
    ok('D4 The Floor lands on The Tape (Gigs)', true);
    await D.page.getByText('The Street', { exact: true }).first().click();
    await D.page.getByRole('button', { name: /Options Alley/ }).click();
    await D.page.getByText('Calls — vs the market').waitFor({ timeout: 5000 });
    ok('D5 Options Alley lands on The Tape (Calls)', true);
    ok('D6 zero console errors in world D', D.errors.length === 0);
    if (D.errors.length) console.log('   errors:', D.errors.slice(0, 5));
    await D.ctx.close();

    // ---- world E: the public economy page: no session, aggregates and audits, and a
    // way into the game (apps/web/src/Economy.tsx; chainless here, so proof of reserves
    // is honestly "not checked") ----
    const E = await newWorld(browser);
    await E.page.goto(`http://127.0.0.1:${PORT_WEB}/economy`);
    await E.page.getByRole('heading', { name: 'The economy, live' }).waitFor({ timeout: 10000 });
    await E.page.getByText('Scrip conservation').waitFor({ timeout: 10000 });
    ok('E1 the page reads the ledger without creating a session',
      (await E.ctx.cookies()).every((c) => c.name !== 'fox_session'));
    ok('E2 Scrip is shown by provenance, Settled and Unsettled',
      await E.page.getByText('Settled', { exact: true }).count() === 1
      && await E.page.getByText('Unsettled', { exact: true }).count() === 1);
    ok('E3 three ledger audits hold; proof of reserves is not claimed without a chain',
      await E.page.getByText('Holds', { exact: true }).count() === 3
      && await E.page.getByText('Not checked', { exact: true }).count() === 2
      && await E.page.getByText('Broken', { exact: true }).count() === 0);
    ok('E4 no launch section without a configured launch',
      await E.page.getByText('on the open market').count() === 0);
    await E.page.getByRole('link', { name: 'Play the game' }).click();
    await E.page.getByText('Your Book').first().waitFor({ timeout: 10000 });
    ok('E5 "Play the game" opens the game and boots a session',
      (await E.ctx.cookies()).some((c) => c.name === 'fox_session'));
    ok('E6 zero console errors in world E', E.errors.length === 0);
    if (E.errors.length) console.log('   errors:', E.errors.slice(0, 5));
    await E.ctx.close();

    // ---- world F: the Wire (Wire Calls on Panta markets, GDD §5.1). With no Panta source
    // the section is quiet; on a server reading the Panta fixture the listed markets render
    // with the "Powered by Panta" attribution, and taking YES spends 20 Risk and prints the
    // call on its row ----
    const Fq = await newWorld(browser);
    await Fq.page.goto(`http://127.0.0.1:${PORT_WEB}/`);
    await Fq.page.getByText('Your Book').first().waitFor({ timeout: 10000 });
    await Fq.page.getByText('The Wire is quiet').waitFor({ timeout: 10000 });
    ok('F1 without a Panta source the Wire shows the quiet state',
      await Fq.page.locator('#tape-wire .ofx-action').count() === 0);
    ok('F1b zero console errors on the quiet Wire', Fq.errors.length === 0);
    if (Fq.errors.length) console.log('   errors:', Fq.errors.slice(0, 5));
    await Fq.ctx.close();

    server.kill();
    await new Promise((r) => setTimeout(r, 500));
    writeWireFixture();
    server = startServer({ OUTFOX_WIRE_FIXTURE: WIRE_FIXTURE });
    await waitHttp(`http://127.0.0.1:${PORT_API}/api/market`);
    const F = await newWorld(browser);
    await F.page.goto(`http://127.0.0.1:${PORT_WEB}/`);
    await F.page.getByText('Haaland 8+ points, GW6').waitFor({ timeout: 10000 });
    const wireRows = F.page.locator('#tape-wire .ofx-action');
    ok('F2 the Wire lists five markets, soonest first',
      await wireRows.count() === 5
      && (await wireRows.first().locator('.ofx-action__title').textContent()) === 'Haaland 8+ points, GW6');
    const attribution = F.page.locator('#tape-wire a');
    ok('F3 attribution reads exactly "Powered by Panta" and links to panta.market',
      await attribution.count() === 1
      && (await attribution.textContent()) === 'Powered by Panta'
      && (await attribution.getAttribute('href')) === 'https://panta.market');
    const riskMeter = F.page.getByRole('meter', { name: 'Risk Appetite' });
    const riskBefore = Number(await riskMeter.getAttribute('aria-valuenow'));
    const haaland = wireRows.filter({ hasText: 'Haaland 8+ points, GW6' });
    const [took] = await Promise.all([
      F.page.waitForResponse((r) => r.url().endsWith('/api/actions/wire')),
      haaland.getByRole('button', { name: 'YES 50%', exact: true }).click(),
    ]);
    const tookBody = await took.json();
    await haaland.getByText('Your call: YES at 50%.').waitFor({ timeout: 5000 });
    const riskShown = Number(await riskMeter.getAttribute('aria-valuenow'));
    ok('F4 taking YES drops Risk by 20 (state-after, and on the meter)',
      took.status() === 200 && tookBody.player.risk === riskBefore - 20
      && riskShown >= riskBefore - 20 && riskShown <= riskBefore - 19);
    ok('F5 the row prints the call and its pay, and turns Taken',
      await haaland.getByText('Pays 200 Scrip if right.').count() === 1
      && await haaland.getByRole('button', { name: 'Taken', exact: true }).isDisabled());
    ok('F6 Your Book carries the open Wire call',
      await F.page.getByText('Wire calls open · 1').isVisible()
      && await F.page.getByText('Pays up to 200 Scrip if right').isVisible());
    ok('F7 zero console errors in world F', F.errors.length === 0);
    if (F.errors.length) console.log('   errors:', F.errors.slice(0, 5));
    await F.ctx.close();

    await browser.close();
  } catch (e) {
    fail++;
    console.log('FAIL (exception)', e.message);
  } finally {
    cleanup();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
