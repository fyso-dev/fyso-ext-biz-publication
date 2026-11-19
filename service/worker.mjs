const requestLimit = 1024 * 1024;
const responseLimit = 5 * 1024 * 1024;
const requestTimeout = 20_000;
const maxRequests = 16;

const error = (status, message) => new Response(message, {
  status, headers: { 'Cache-Control': 'no-store' },
});

async function boundedBody(request, limit) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw Error('body_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.toBase64();
}

const hopHeaders = new Set(['connection', 'content-length', 'transfer-encoding', 'upgrade',
  'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'host']);

function forwardHeaders(headers) {
  const nominated = new Set((headers.get('connection') || '').toLowerCase().split(',').map(value => value.trim()));
  return [...headers].filter(([name]) => !hopHeaders.has(name) && !nominated.has(name) &&
    !name.startsWith('cf-') && !name.startsWith('x-forwarded-'));
}

export class PanelPublication {
  constructor(ctx) {
    this.ctx = ctx;
    this.pending = new Map();
    this.waiter = null;
    this.lastPoll = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.split('/')[1];
    const enabled = await this.ctx.storage.get('enabled') === true;
    if (action === 'publish') {
      await this.ctx.storage.put('enabled', true);
      return Response.json({ enabled: true });
    }
    if (action === 'revoke') {
      await this.ctx.storage.put('enabled', false);
      for (const job of this.pending.values()) job.finish(error(404, 'Publication disabled'));
      this.releasePoll(null);
      return Response.json({ enabled: false });
    }
    if (action === 'status') return Response.json({ enabled, connected: enabled && Date.now() - this.lastPoll < 25_000 });
    if (!enabled) return error(404, 'Publication disabled');
    if (action === 'next') return this.next();
    if (action === 'complete') return this.complete(url.searchParams.get('id'), request);
    if (action === 'origin') return this.proxy(request, url);
    return error(404, 'Unknown operation');
  }

  releasePoll(job) {
    if (!this.waiter) return;
    const { finish, timer } = this.waiter;
    this.waiter = null;
    clearTimeout(timer);
    if (job) finish(this.dispatch(job));
    else finish(new Response(null, { status: 204 }));
  }

  dispatch(job) {
    job.dispatched = true;
    return Response.json(job.message);
  }

  next() {
    this.lastPoll = Date.now();
    for (const job of this.pending.values()) {
      if (!job.dispatched) return this.dispatch(job);
    }
    if (this.waiter) return error(409, 'Connector already polling');
    return new Promise(finish => {
      this.waiter = { finish, timer: setTimeout(() => this.releasePoll(null), 15_000) };
    });
  }

  async proxy(request, url) {
    if (request.headers.has('upgrade')) return error(501, 'Protocol upgrade unavailable');
    if (Date.now() - this.lastPoll >= 25_000) return error(503, 'Panel connector offline');
    if (this.pending.size >= maxRequests) return error(503, 'Panel connector busy');
    let body;
    try {
      body = await boundedBody(request, requestLimit);
    } catch {
      return error(413, 'Request body too large');
    }
    // Reading a body yields. Check revocation and capacity again before enqueuing.
    if (await this.ctx.storage.get('enabled') !== true) return error(404, 'Publication disabled');
    if (this.pending.size >= maxRequests) return error(503, 'Panel connector busy');
    const id = crypto.randomUUID();
    return new Promise(resolve => {
      const finish = response => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(response);
      };
      const timer = setTimeout(() => finish(error(504, 'Panel origin timed out')), requestTimeout);
      const job = {
        message: {
          id,
          host: url.searchParams.get('host'),
          path: url.searchParams.get('path'),
          method: request.method,
          headers: forwardHeaders(request.headers),
          body,
        },
        finish,
      };
      this.pending.set(id, job);
      this.releasePoll(job);
    });
  }

  async complete(id, request) {
    const job = this.pending.get(id);
    if (!job?.dispatched) return error(404, 'Unknown request');
    try {
      const encoded = await boundedBody(request, responseLimit * 2);
      const result = JSON.parse(new TextDecoder().decode(Uint8Array.fromBase64(encoded)));
      const body = result.body ? Uint8Array.fromBase64(result.body) : null;
      if (body && body.length > responseLimit) throw Error('body_too_large');
      const headers = new Headers(result.headers);
      // Cookie fields are separate tuples on the wire. Preserve each one.
      const responseHeaders = new Headers(forwardHeaders(headers));
      responseHeaders.delete('set-cookie');
      for (const cookie of headers.getSetCookie()) responseHeaders.append('Set-Cookie', cookie);
      responseHeaders.set('Cache-Control', 'private, no-store');
      job.finish(new Response(body, { status: result.status, headers: responseHeaders }));
      return new Response(null, { status: 204 });
    } catch {
      job.finish(error(502, 'Invalid origin response'));
      return error(400, 'Invalid origin response');
    }
  }
}

const actions = new Map([['publish', 'POST'], ['revoke', 'POST'], ['status', 'GET'],
  ['next', 'POST'], ['complete', 'POST']]);

function relay(env, domain) {
  return env.PUBLICATION_RELAY.get(env.PUBLICATION_RELAY.idFromName(domain));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const assignments = JSON.parse(env.PUBLICATION_ASSIGNMENTS || '{}');
    if (url.hostname === env.PUBLICATION_CONTROL_HOST) {
      const [, prefix, domain, action, trailing] = url.pathname.split('/');
      if (prefix !== 'v1' || trailing !== undefined || actions.get(action) !== request.method) {
        return error(404, 'Unknown operation');
      }
      const owner = Object.hasOwn(assignments, domain) ? assignments[domain] : null;
      const auth = request.headers.get('authorization');
      if (!owner || !auth?.startsWith('Bearer ')) return error(403, 'Publication access denied');
      const profile = await fetch(new URL('/oauth/userinfo', env.BIZ_ORIGIN), {
        headers: { Authorization: auth }, redirect: 'manual', signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      if (!profile) return error(503, 'Fyso Biz identity unavailable');
      const identity = profile.ok ? await profile.json().catch(() => null) : null;
      if (identity?.sub !== owner || identity.email_verificado !== true) return error(403, 'Publication access denied');
      const target = new URL(`https://relay.invalid/${action}`);
      if (action === 'complete') target.searchParams.set('id', url.searchParams.get('id') || '');
      const response = await relay(env, domain).fetch(new Request(target, request));
      if (action !== 'status' && action !== 'publish') return response;
      return Response.json({ ...await response.json(), url: `https://panel.${domain}` }, {
        status: response.status, headers: { 'Cache-Control': 'no-store' },
      });
    }

    const [app, ...labels] = url.hostname.split('.');
    const domain = labels.join('.');
    if (!['panel', 'auth'].includes(app) || !Object.hasOwn(assignments, domain)) return error(404, 'Unknown host');
    const target = new URL('https://relay.invalid/origin');
    target.searchParams.set('host', url.hostname);
    target.searchParams.set('path', url.pathname + url.search);
    return relay(env, domain).fetch(new Request(target, request));
  },
};
