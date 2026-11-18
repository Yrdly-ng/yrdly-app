import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { request } from 'node:http';

// Loopback-only TLS for WebKit's Secure auth cookies. The disposable CI
// container trusts its own test certificate; application auth stays unchanged.
const [certPath, keyPath] = process.argv.slice(2);
if (!certPath || !keyPath) throw new Error('Provide the local QA certificate and key paths');
createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, (req, res) => {
  const upstream = request({
    hostname: '127.0.0.1', port: 9002, path: req.url, method: req.method,
    headers: { ...req.headers, 'x-forwarded-proto': 'https' },
  }, (response) => {
    res.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(res);
  });
  upstream.on('error', () => {
    res.writeHead(502).end('QA server unavailable');
  });
  req.pipe(upstream);
}).listen(9443, '127.0.0.1');
