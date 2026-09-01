import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Chromium cannot reach the tile CDN through this sandbox's proxy, but curl
// can. Intercept tile requests and fulfil them from a curl-backed disk cache.
const TILE_CACHE = '/tmp/claude-0/-home-user-CodeCrew/795c1959-0f42-5c95-8833-ea1e604d87c3/scratchpad/tiles';
fs.mkdirSync(TILE_CACHE, { recursive: true });
function fetchTile(url) {
  const key = url.replace(/[^a-z0-9]/gi, '_') + '.png';
  const file = path.join(TILE_CACHE, key);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  try {
    const buf = execFileSync('curl', ['-sS', '--max-time', '20', '-A', 'ner-logistics-demo/0.1', url],
      { maxBuffer: 8 << 20, encoding: 'buffer' });
    if (buf.length > 100) { fs.writeFileSync(file, buf); return buf; }
  } catch { /* fall through - the map still renders without a basemap */ }
  return null;
}
const OUT = '/home/user/CodeCrew/docs/assets';
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  proxy: proxy ? { server: proxy, bypass: 'localhost,127.0.0.1' } : undefined,
  args: [
    '--ignore-certificate-errors',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-update',
  ],
});
const page = await b.newPage({
  viewport: { width: 1680, height: 1000 },
  deviceScaleFactor: 2,
  ignoreHTTPSErrors: true,
});
let tiles = 0;
await page.route('**://*.tile.openstreetmap.org/**', async (route) => {
  const body = fetchTile(route.request().url());
  if (body) { tiles++; await route.fulfill({ status: 200, contentType: 'image/png', body }); }
  else await route.abort();
});
const errs = []; page.on('pageerror', e => errs.push(e.message));

const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('  ->', name); };
const settle = (ms=3000) => page.waitForTimeout(ms);

await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' });
await settle(2000);

// 1. Planner, live conditions, emergency medical to a remote hill town.
await page.selectOption('select >> nth=2', 'IMF');
await page.selectOption('select >> nth=3', 'emergency_medical');
await page.getByRole('button', { name: /Plan route/i }).click();
await settle(4500);
await shot('ui-planner');

// 2. Network risk under the Barak flood scenario.
await page.selectOption('header select', 'barak_flood');
await settle(1500);
await page.getByRole('tab', { name: 'Network Risk' }).click();
await settle(5000);
await shot('ui-risk');

// 3. Accessibility atlas (live).
await page.selectOption('header select', 'live');
await settle(1200);
await page.getByRole('tab', { name: 'Accessibility Atlas' }).click();
await settle(4500);
await shot('ui-atlas');

// 4. Field mode with a bulletin.
await page.getByRole('tab', { name: 'Field Mode' }).click();
await settle(1200);
await page.getByRole('button', { name: /Request bulletin/i }).click();
await settle(3000);
await shot('ui-field');

// 5. Model & data.
await page.getByRole('tab', { name: 'Model & Data' }).click();
await settle(2500);
await shot('ui-model');

console.log('tile responses:', tiles, '| page errors:', errs.length ? errs : 'none');
await b.close();
