#!/usr/bin/env node
// @ts-check
/* global console */
/**
 * scripts/ngrok-proxy.mjs
 *
 * A thin Node.js reverse-proxy that sits in front of both dev servers:
 *   /session, /healthz, /ws  →  gateway (port 8080)
 *   everything else          →  Next.js web (port 3000)
 *
 * Also handles WebSocket upgrades for the /ws path (the realtime audio socket).
 *
 * Usage:
 *   node scripts/ngrok-proxy.mjs [port]
 *
 * Then run ngrok pointing at this port:
 *   ngrok http <port>
 */

import http from 'node:http';
import net from 'node:net';

const PROXY_PORT = Number(process.argv[2]) || 3001;
const WEB_PORT   = 3000;
const GATEWAY_PORT = 8080;

const isGateway = (url) =>
  url.startsWith('/ws') ||
  url.startsWith('/session') ||
  url.startsWith('/healthz');

const server = http.createServer((req, res) => {
  const targetPort = isGateway(req.url ?? '') ? GATEWAY_PORT : WEB_PORT;

  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${targetPort}`,
        'x-forwarded-host': req.headers.host ?? '',
        'x-forwarded-proto': 'https',
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502);
    res.end('Bad Gateway: ' + err.message);
  });

  req.pipe(proxyReq);
});

// WebSocket upgrade (the realtime audio socket goes to the gateway)
server.on('upgrade', (req, clientSocket, head) => {
  const targetPort = isGateway(req.url ?? '') ? GATEWAY_PORT : WEB_PORT;
  const proxySocket = net.connect(targetPort, '127.0.0.1', () => {
    // Forward the HTTP Upgrade request as-is
    proxySocket.write(`${req.method} ${req.url} HTTP/1.1\r\n`);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      proxySocket.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
    }
    proxySocket.write('\r\n');
    if (head?.length) proxySocket.write(head);
    clientSocket.pipe(proxySocket);
    proxySocket.pipe(clientSocket);
  });
  proxySocket.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => proxySocket.destroy());
});

server.listen(PROXY_PORT, () => {
  console.log(`\nBolBill ngrok proxy ready on port ${PROXY_PORT}`);
  console.log(`  /ws, /session, /healthz → gateway :${GATEWAY_PORT}`);
  console.log(`  everything else          → web     :${WEB_PORT}`);
  console.log(`\nNow run:  ngrok http ${PROXY_PORT}\n`);
});

