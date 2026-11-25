const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3101;
const BASE = `http://localhost:${PORT}`;
let failures = 0;
let passes = 0;

function log(ok, msg) {
  const line = `${ok ? 'PASS' : 'FAIL'} ${msg}`;
  console.log(line);
  if (ok) passes++; else failures++;
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function req(method, urlPath, { headers = {}, body, json } = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? body : (json != null ? JSON.stringify(json) : null);
    const u = new URL(urlPath, BASE);
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: { ...headers }
    };
    if (data && !opts.headers['Content-Length']) opts.headers['Content-Length'] = Buffer.byteLength(data);
    if (json != null && !opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, buf, text, json: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  server.stdout.on('data', d => out += d.toString());
  server.stderr.on('data', d => out += d.toString());

  try {
    for (let i = 0; i < 50; i++) {
      if (out.includes('Server running')) break;
      await wait(100);
    }
    log(out.includes('Server running'), 'server starts');

    const root = await req('GET', '/');
    log(root.status === 200 && root.text.includes('Create Vault'), 'home page serves and contains core flow');
    log(root.text.includes('Security:'), 'home page includes security disclosure');

    for (const p of ['/app.js', '/styles.css', '/manifest.json', '/drop.html', '/favicon.png']) {
      const r = await req('GET', p);
      log(r.status === 200, `static asset ${p} returns 200`);
    }

    for (const p of ['/server.js', '/package.json', '/.env', '/.gitignore']) {
      const r = await req('GET', p);
      log(r.status === 404, `sensitive path ${p} is blocked`);
    }

    const badToken = await req('GET', '/drop-info/..bad!token');
    log(badToken.status === 400, 'invalid drop token is rejected');

    // Hosted drop flow: session -> chunk -> finalize -> info -> download
    const plain = Buffer.from('smoke-test-content');
    const fileContent = Buffer.concat([plain, Buffer.alloc(16, 1)]); // simulate ciphertext size (plain + 16-byte tag)
    const session = await req('POST', '/upload-session', { json: { name: 'smoke.txt', size: plain.length, expiry: 60000 } });
    log(session.status === 200 && session.json && session.json.token, 'upload session created');

    if (session.json && session.json.token) {
      const token = session.json.token;
      const boundary = '----smokeboundary' + Date.now();
      const part = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
      const fileHead = `--${boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="chunk"\r\nContent-Type: application/octet-stream\r\n\r\n`;
      const tail = `\r\n--${boundary}--\r\n`;
      const body = Buffer.concat([
        Buffer.from(part('token', token) + part('index', '0') + fileHead),
        fileContent,
        Buffer.from(tail)
      ]);
      const up = await req('POST', '/upload-chunk', { headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
      log(up.status === 200, 'upload chunk accepted');

      const fin = await req('POST', '/upload-finalize', { json: { token } });
      log(fin.status === 200, 'upload finalized');

      const info = await req('GET', `/drop-info/${token}`);
      log(info.status === 200 && info.json && info.json.filename === 'smoke.txt', 'drop info returns metadata');

      const dl = await req('GET', `/download-chunk/${token}/0`);
      log(dl.status === 200 && dl.buf.length > 0, 'download chunk returns data');
    }

    console.log(`\nSmoke result: ${passes} passed, ${failures} failed`);
    process.exit(failures ? 1 : 0);
  } finally {
    try { server.kill(); } catch {}
  }
}

run().catch(err => { console.error(err); process.exit(1); });
