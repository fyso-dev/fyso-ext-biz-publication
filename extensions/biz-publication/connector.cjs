'use strict';

const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');

const responseLimit = 5 * 1024 * 1024;
const dnsName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const actions = new Set(['status', 'publish', 'revoke', 'doctor', 'connect']);

function configuration(env) {
  const domain = env.FYSO_WEB_DOMAIN || '';
  if (!dnsName.test(domain) || domain.length > 247 || /\.(localhost|local|invalid|test|example)$/.test(domain)) {
    throw Error('Set the project web_domain to its assigned public domain.');
  }
  const port = Number(env.FYSO_HTTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid project HTTP port.');
  const service = new URL(env.FYSO_PUBLICATION_SERVICE || '');
  if (service.protocol !== 'https:' || service.username || service.password ||
      service.search || service.hash || service.pathname !== '/') {
    throw Error('Set the HTTPS origin of the Fyso Biz publication service.');
  }
  if (!env.FYSO_PUBLICATION_TOKEN) throw Error('Configure the Fyso Biz publication credential.');
  return { domain, port, service, token: env.FYSO_PUBLICATION_TOKEN };
}

function control(config, action, { signal, id, body } = {}) {
  const url = new URL(`/v1/${config.domain}/${action}`, config.service);
  if (id) url.searchParams.set('id', id);
  const timeout = AbortSignal.timeout(23_000);
  return fetch(url, {
    method: action === 'status' ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${config.token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

function localRequest(config, message, signal) {
  const { host, path, method, headers, body } = message;
  if (![ `panel.${config.domain}`, `auth.${config.domain}` ].includes(host) ||
      typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') ||
      /[\r\n\\]/.test(path) || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) {
    throw Error('Invalid origin request.');
  }
  const payload = Buffer.from(body, 'base64');
  if (payload.length > 1024 * 1024) throw Error('Origin request body too large.');
  const upstreamHeaders = Object.fromEntries(headers);
  upstreamHeaders.host = host;
  delete upstreamHeaders['transfer-encoding'];
  delete upstreamHeaders.connection;
  upstreamHeaders['content-length'] = payload.length;

  return new Promise((resolve, reject) => {
    const req = http.request({
      method, path, hostname: '127.0.0.1', port: config.port,
      headers: upstreamHeaders, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    }, async response => {
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of response) {
          size += chunk.length;
          if (size > responseLimit) throw Error('Origin response body too large.');
          chunks.push(chunk);
        }
        const sourceHeaders = response.rawHeaders;
        const responseHeaders = [];
        for (let i = 0; i < sourceHeaders.length; i += 2) {
          responseHeaders.push([sourceHeaders[i].toLowerCase(), sourceHeaders[i + 1]]);
        }
        resolve({ status: response.statusCode, headers: responseHeaders, body: Buffer.concat(chunks).toString('base64') });
      } catch (error) {
        reject(error);
      }
    });
    req.once('error', reject);
    req.end(payload);
  });
}

async function serve(config, message, signal) {
  let body;
  try {
    body = await localRequest(config, message, signal);
  } catch {
    body = { status: 502, headers: [], body: Buffer.from('Panel origin unavailable').toString('base64') };
  }
  const result = await control(config, 'complete', { id: message.id, signal, body });
  await result.body?.cancel();
}

async function connect(config) {
  const controller = new AbortController();
  const { signal } = controller;
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const active = new Set();
  try {
    while (!signal.aborted) {
      try {
        if (active.size >= 4) await Promise.race(active);
        const response = await control(config, 'next', { signal });
        if (response.status === 204) continue;
        if (response.ok) {
          const message = await response.json();
          const operation = serve(config, message, signal).catch(() => {}).finally(() => active.delete(operation));
          active.add(operation);
          continue;
        }
        await response.body?.cancel();
      } catch {
        if (signal.aborted) break;
      }
      await delay(3000, undefined, { signal }).catch(() => {});
    }
  } finally {
    await Promise.allSettled([...active]);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

async function main(action) {
  if (!actions.has(action)) throw Error('Expected connect, status, publish, revoke or doctor.');
  const config = configuration(process.env);
  if (action === 'connect') return connect(config);
  const response = await control(config, action === 'doctor' ? 'status' : action);
  if (!response.ok) throw Error(`Fyso Biz publication returned HTTP ${response.status}.`);
  const status = await response.json();
  if (action === 'doctor' && (!status.enabled || !status.connected)) {
    throw Error('The Fyso Biz publication is disabled or the connector is offline.');
  }
  console.log(JSON.stringify(status));
}

module.exports = { localRequest };
if (require.main === module) main(process.argv[2]).catch(() => {
  // Network and parse errors may embed untrusted provider data.
  console.error('Fyso Biz publication check failed. Verify the assigned domain, credential and service status.');
  process.exitCode = 1;
});
