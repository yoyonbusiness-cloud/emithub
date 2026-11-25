const { spawn } = require('child_process');
const path = require('path');

const PORT = 3102;
const BASE = `http://localhost:${PORT}`;

async function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  let puppeteer;
  try { puppeteer = require('puppeteer'); } catch (e) {
    console.log('SKIP browser smoke: puppeteer not available');
    process.exit(0);
  }
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore','pipe','pipe']
  });
  let out=''; server.stdout.on('data',d=>out+=d.toString()); server.stderr.on('data',d=>out+=d.toString());
  for (let i=0;i<50;i++){ if(out.includes('Server running')) break; await wait(100); }
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const title = await page.title();
    const hasCreate = await page.$('#show-generate-btn');
    const hasJoin = await page.$('#show-join-btn');
    const hasHosted = await page.$('#show-hosted-btn');
    const hasSecurity = await page.content().then(c => c.includes('Security:'));
    const pass = /emit/i.test(title) && hasCreate && hasJoin && hasHosted && hasSecurity;
    console.log(pass ? 'PASS browser smoke' : 'FAIL browser smoke');
    if (!pass) {
      console.log({ title, hasCreate: !!hasCreate, hasJoin: !!hasJoin, hasHosted: !!hasHosted, hasSecurity });
      process.exitCode = 1;
    }
  } catch (e) {
    console.error('FAIL browser smoke', e.message);
    process.exitCode = 1;
  } finally {
    try { await browser?.close(); } catch {}
    try { server.kill(); } catch {}
  }
})();
