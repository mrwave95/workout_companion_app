const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const scope = 'https://example.test/workouts/';
const prefix = `racked:${scope}:`;
const current = `${prefix}v5`;
const shell = `${scope}index.html`;
const source = fs.readFileSync(require('node:path').join(__dirname, '../sw.js'), 'utf8');

function worker({fetch: fetchImpl = async () => new Response('fresh'), fastTimeout = false} = {}) {
  const handlers = {}, stores = new Map(), deleted = [], precached = [];
  let skipped = 0, claimed = 0, cacheFailure = false;
  const caches = {
    async open(name) {
      if (cacheFailure) throw new Error('quota');
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(requests) {
          precached.push(...requests);
          const responses = await Promise.all(requests.map(fetchImpl));
          if (responses.some(response => !response.ok)) throw new Error('precache failed');
          requests.forEach((request, i) => store.set(request.url, responses[i].clone()));
        },
        async put(key, response) { store.set(key, response.clone()); },
        async match(key) { return store.get(key)?.clone(); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(key) { deleted.push(key); return stores.delete(key); }
  };
  vm.runInNewContext(source, {
    self: {registration: {scope}, addEventListener: (name, fn) => { handlers[name] = fn; },
      skipWaiting: async () => { skipped++; }, clients: {claim: async () => { claimed++; }}},
    caches, fetch: fetchImpl, URL, Request, Response,
    setTimeout: fastTimeout ? fn => setTimeout(fn, 0) : setTimeout, clearTimeout
  });
  return {
    stores, deleted, precached,
    get skipped() { return skipped; }, get claimed() { return claimed; },
    failCache() { cacheFailure = true; },
    async seed(key, text, name = current) { (await caches.open(name)).put(key, new Response(text)); },
    async lifecycle(name) { let completion; handlers[name]({waitUntil: p => { completion = p; }}); await completion; },
    fetch(url = shell, options) {
      const promises = []; let response;
      handlers.fetch({request: new Request(url, options), waitUntil: p => promises.push(p),
        respondWith: p => { response = p; }});
      return {response, complete: () => Promise.all(promises)};
    }
  };
}

test('installation atomically precaches the shell and assets with HTTP-cache refresh', async () => {
  const w = worker(); await w.lifecycle('install');
  assert.equal(w.skipped, 1);
  assert.deepEqual(w.precached.map(request => request.url),
    ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'].map(path => scope + path));
  assert(w.precached.every(request => request.cache === 'reload'));
});

test('failed precache does not activate a broken update', async () => {
  const w = worker({fetch: async () => new Response('error', {status: 500})});
  await assert.rejects(w.lifecycle('install'), /precache failed/);
  assert.equal(w.skipped, 0);
});

test('activation deletes only old caches owned by this scope', async () => {
  const w = worker();
  for (const name of ['other-app', 'racked-cache-v4', `racked:https://example.test/sibling/:v5`, `${prefix}v4`, current]) {
    w.stores.set(name, new Map());
  }
  await w.lifecycle('activate');
  assert.deepEqual(w.deleted, [`${prefix}v4`]);
  assert(w.stores.has('other-app')); assert(w.stores.has('racked-cache-v4'));
  assert.equal(w.claimed, 1);
});

test('fresh network response replaces canonical shell and extends event lifetime for the write', async () => {
  let requestOptions;
  const w = worker({fetch: async (_, options) => { requestOptions = options; return new Response('fresh'); }});
  await w.seed(shell, 'old');
  const event = w.fetch(scope + '?source=installed');
  assert.equal(await (await event.response).text(), 'fresh');
  await event.complete();
  assert.equal(await w.stores.get(current).get(shell).text(), 'fresh');
  assert.equal(w.stores.get(current).size, 1);
  assert.equal(requestOptions.cache, 'no-cache');
});

test('HTTP error uses good cached shell and cannot poison it', async () => {
  const w = worker({fetch: async () => new Response('broken', {status: 503})});
  await w.seed(shell, 'cached app');
  const event = w.fetch();
  assert.equal(await (await event.response).text(), 'cached app');
  await event.complete();
  assert.equal(await w.stores.get(current).get(shell).text(), 'cached app');
});

test('offline query-string launch falls back to the canonical shell', async () => {
  const w = worker({fetch: async () => { throw new TypeError('offline'); }});
  await w.seed(shell, 'offline app');
  const event = w.fetch(shell + '?tracking=1');
  assert.equal(await (await event.response).text(), 'offline app');
  await event.complete();
});

test('a slow network falls back promptly and its eventual response refreshes the cache', async () => {
  let resolveNetwork;
  const w = worker({fetch: () => new Promise(resolve => { resolveNetwork = resolve; }), fastTimeout: true});
  await w.seed(shell, 'cached app');
  const event = w.fetch();
  assert.equal(await (await event.response).text(), 'cached app');
  resolveNetwork(new Response('late fresh app')); await event.complete();
  assert.equal(await w.stores.get(current).get(shell).text(), 'late fresh app');
});

test('requests outside the finite asset set are left to the browser', () => {
  const w = worker();
  for (const [url, options] of [
    ['https://other.test/index.html'], [scope + 'unknown.json'],
    [shell, {method: 'POST'}], [shell, {headers: {range: 'bytes=0-10'}}]
  ]) assert.equal(w.fetch(url, options).response, undefined);
});

test('cache failures do not break an otherwise healthy online app', async () => {
  const w = worker(); w.failCache(); const event = w.fetch();
  assert.equal(await (await event.response).text(), 'fresh'); await event.complete();
});

test('without a cached copy HTTP errors are preserved and offline errors return a response', async () => {
  const failing = worker({fetch: async () => new Response('error', {status: 502})}).fetch();
  assert.equal((await failing.response).status, 502); await failing.complete();
  const offline = worker({fetch: async () => { throw new TypeError('offline'); }}).fetch();
  assert.equal((await offline.response).status, 503); await offline.complete();
});

test('partial and redirected responses cannot replace a complete cached asset', async () => {
  for (const response of [new Response('partial', {status: 206}),
    Object.defineProperty(new Response('redirected'), 'redirected', {value: true})]) {
    const w = worker({fetch: async () => response});
    await w.seed(shell, 'complete app'); const event = w.fetch();
    assert((await event.response).ok); await event.complete();
    assert.equal(await w.stores.get(current).get(shell).text(), 'complete app');
  }
});
