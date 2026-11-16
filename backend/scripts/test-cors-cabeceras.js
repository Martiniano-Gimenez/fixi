'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PERMITIDOS = ['https://panel.example.test', 'https://publico.example.test'];
function cabeceras(res) {
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('x-powered-by'), null);
}
async function probarHttp() {
  await ensureTestDb();
  const { app } = require('../src/index');
  const { startTestServer } = require('./utils/testServer');
  const produccion = process.env.NODE_ENV === 'production';
  const configurado = Boolean(process.env.CORS_ORIGIN);
  const htmlPath = path.resolve(__dirname, '../../frontend/dist/index.html');
  let temporal;
  if (produccion && !fs.existsSync(htmlPath)) {
    temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'fixi-csp-'));
    fs.writeFileSync(path.join(temporal, 'index.html'), '<!doctype html><html><body>Frontend de prueba</body></html>');
    const sendFile = app.response.sendFile;
    app.response.sendFile = function (archivo, ...args) {
      assert.equal(archivo, htmlPath);
      return sendFile.call(this, path.join(temporal, 'index.html'), ...args);
    };
  }
  const { server, baseUrl } = await startTestServer();
  const origen = baseUrl.replace(/\/api$/, '');
  const pedir = async (ruta, opciones) => {
    const res = await fetch(`${origen}${ruta}`, opciones);
    cabeceras(res);
    return res;
  };
  try {
    let res = await pedir('/api/health');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(res.headers.get('content-security-policy'), null, 'La CSP del frontend no se aplica a la API');
    for (const origin of ['https://ajeno.example.test', 'https://panel.example.test.evil.test', 'null', ...PERMITIDOS]) {
      res = await pedir('/api/health', { headers: { Origin: origin } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), configurado && PERMITIDOS.includes(origin) ? origin : null);
    }
    for (const origin of ['https://ajeno.example.test', ...PERMITIDOS]) {
      res = await pedir('/api/health', { method: 'OPTIONS', headers: { Origin: origin,
        'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type' } });
      if (configurado && PERMITIDOS.includes(origin)) {
        assert.equal(res.status, 204);
        assert.equal(res.headers.get('access-control-allow-origin'), origin);
        assert.match(res.headers.get('access-control-allow-methods'), /PATCH/);
        const headers = res.headers.get('access-control-allow-headers').toLowerCase().split(',').map(h => h.trim());
        assert.ok(headers.includes('authorization') && headers.includes('content-type'));
        assert.match(res.headers.get('vary'), /Origin/);
      } else assert.equal(res.headers.get('access-control-allow-origin'), null);
    }
    assert.equal((await pedir('/api/inexistente')).status, 404);
    assert.equal((await pedir('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    res = await pedir('/login');
    if (produccion) {
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const csp = res.headers.get('content-security-policy');
      for (const directiva of ["default-src 'self'", "frame-ancestors 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:"]) {
        assert.ok(csp.includes(directiva), `Falta ${directiva}`);
      }
      assert.doesNotMatch(csp, /unsafe-eval/);
      const html = await res.text();
      assert.match(html, /<!doctype html>/i);
      const asset = html.match(/src="(\/assets\/[^"]+\.js)"/);
      if (asset) {
        res = await pedir(asset[1]);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-security-policy'), csp);
        assert.match(res.headers.get('content-type'), /javascript/);
        await res.arrayBuffer();
      }
    } else {
      assert.equal(res.status, 404);
      assert.equal(res.headers.get('content-security-policy'), "default-src 'none'", 'El 404 de Express conserva su CSP restrictiva');
    }
    console.log(`PASS CORS y cabeceras: producción=${produccion}, lista configurada=${configurado}; origen, preflight, errores y frontend`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await require('../src/lib/prisma').$disconnect();
    if (temporal) { fs.unlinkSync(path.join(temporal, 'index.html')); fs.rmdirSync(temporal); }
  }
}
async function run() {
  if (process.argv.includes('--http')) return probarHttp();
  await ensureTestDb();
  for (const modo of ['development', 'production']) for (const lista of ['', ` ${PERMITIDOS[0]}, , ${PERMITIDOS[1]} `]) {
    const env = { ...process.env, NODE_ENV: modo };
    if (lista) env.CORS_ORIGIN = lista;
    else delete env.CORS_ORIGIN;
    const r = spawnSync(process.execPath, [__filename, '--http'], { env, encoding: 'utf8', timeout: 60000 });
    process.stdout.write(r.stdout || '');
    assert.equal(r.status, 0, r.stderr || r.error?.message);
  }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
