/** Hydration builder.
 *
 * v0.6 — match mode. When the parent StudioConfig has mode='match', execute()
 * captures the configured target → plugin mapping into config.captures.hydrations
 * and returns a passthrough result without making any network call. The push
 * worker reads the union of captured plugins to call ds_search /hydration/run
 * with one batched request before delivering the webhook.
 */
export class Hydration {
  _index = null;
  _hits = [];
  _targets = {};
  _dropEmptyHits = false;
  lastCall = null;
  lastResult = null;

  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('Hydration: options object is required');
    }
    const { url, apiKey, index = null, hits = [], origin = 'sdk', log, show, mode, captures } = options;
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Hydration: options.url is required and must be a non-empty string');
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Hydration: options.apiKey is required and must be a non-empty string');
    }
    this._url = url.trim().replace(/\/$/, '');
    this._apiKey = apiKey.trim();
    this._index = typeof index === 'string' && index.trim() ? index.trim() : null;
    this._hits = Array.isArray(hits) ? hits.filter((h) => h && typeof h === 'object') : [];
    this._origin = typeof origin === 'string' && origin.trim() ? origin.trim() : 'sdk';
    this._log = typeof log === 'function' ? log : console.log.bind(console);
    this._show = typeof show === 'function' ? show : console.log.bind(console);
    this._mode = mode === 'match' ? 'match' : 'normal';
    this._captures = captures || null;
  }

  index(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Hydration.index: name must be a non-empty string');
    }
    this._index = name.trim();
    return this;
  }
  hits(arr) {
    if (!Array.isArray(arr)) throw new Error('Hydration.hits: argument must be an array of hit objects');
    this._hits = arr.filter((h) => h && typeof h === 'object');
    return this;
  }
  itemIds(ids) {
    if (!Array.isArray(ids)) throw new Error('Hydration.itemIds: ids must be an array of strings');
    this._hits = ids.filter((x) => typeof x === 'string' && x).map((id) => ({ _index: this._index, _id: id, _source: { item_id: id } }));
    return this;
  }
  target(name, spec = {}) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Hydration.target: name must be a non-empty string');
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Hydration.target: spec must be a plain object');
    if (spec.sources !== undefined && !Array.isArray(spec.sources)) throw new Error('Hydration.target: spec.sources must be an array if provided');
    this._targets[name.trim()] = spec;
    return this;
  }
  clearTarget(name) { delete this._targets[name]; return this; }
  clearTargets() { this._targets = {}; return this; }
  dropEmptyHits(value) { this._dropEmptyHits = value === undefined ? true : Boolean(value); return this; }
  getPayload() {
    const payload = { origin: this._origin, index: this._index, hits: this._hits };
    if (Object.keys(this._targets).length > 0) payload.hydrate = this._targets;
    if (this._dropEmptyHits) payload.drop_empty_hits = true;
    return payload;
  }
  /** Snapshot the target→spec map for the push worker. */
  getTargets() {
    const out = {};
    for (const [k, v] of Object.entries(this._targets)) out[k] = { ...v };
    return { index: this._index, targets: out };
  }
  async _post(endpoint, body) {
    const url = `${this._url}${endpoint}`;
    this.log(`Sending request to ${url}`);
    const startTime = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this._apiKey}` },
      body: JSON.stringify(body),
    });
    const frontendTime = Math.round(performance.now() - startTime);
    if (!response.ok) {
      const text = await response.text();
      let message = `Hydration API error: ${response.status} ${response.statusText}`;
      if (text) message += ` — ${text}`;
      this.log(message);
      throw new Error(message);
    }
    const result = await response.json();
    if (result && typeof result.error !== 'undefined' && result.error !== null) {
      const msg = typeof result.error === 'string' ? result.error : String(result.error);
      this.log(msg);
      throw new Error(msg);
    }
    result.took_sdk = frontendTime;
    return result;
  }
  async execute() {
    if (this._mode === 'match') {
      const snap = this.getTargets();
      if (this._captures) this._captures.hydrations.push(snap);
      const stats = { items_in: this._hits.length, items_returned: this._hits.length, targets: {} };
      const res = { hits: this._hits, stats, took_backend: 0, took_sdk: 0 };
      this.lastCall = { endpoint: 'match-mode', payload: snap };
      this.lastResult = res;
      return res;
    }
    if (!this._index) {
      throw new Error('Hydration.execute: index must be set (call mbd.hydration() after addCandidates, or .index(name) explicitly)');
    }
    if (!Array.isArray(this._hits) || this._hits.length === 0) {
      throw new Error('Hydration.execute: hits is empty (call mbd.hydration() after addCandidates, or .hits([...]) / .itemIds([...]) explicitly)');
    }
    const endpoint = '/hydration/run';
    const payload = this.getPayload();
    const result = await this._post(endpoint, payload);
    const res = result.result;
    if (!res) throw new Error('Hydration.execute: result.result is undefined');
    this.lastCall = { endpoint, payload };
    this.lastResult = result;
    this._log('Hydration result:');
    this._log(`  took_sdk_ms: ${result.took_sdk}`);
    this._log(`  took_backend_ms: ${res.took_backend ?? 0}`);
    const stats = res.stats || {};
    if (stats.items_in != null) this._log(`  items_in: ${stats.items_in}`);
    if (stats.items_returned != null) this._log(`  items_returned: ${stats.items_returned}`);
    return res;
  }
  async describe() {
    if (this._mode === 'match') return { targets: {} };
    if (!this._index) throw new Error('Hydration.describe: index must be set');
    const endpoint = '/hydration/describe';
    const body = { origin: this._origin, index: this._index };
    if (Object.keys(this._targets).length > 0) body.hydrate = this._targets;
    const result = await this._post(endpoint, body);
    this.lastCall = { endpoint, payload: body };
    this.lastResult = result;
    return result.result || result;
  }
  async preview(itemId) {
    if (this._mode === 'match') return { hits: [], stats: { items_in: 0, items_returned: 0, targets: {} } };
    let oneId = typeof itemId === 'string' && itemId.trim() ? itemId.trim() : null;
    if (!oneId && this._hits.length > 0) {
      const h = this._hits[0];
      oneId = (h._source && h._source.item_id) || h._id || null;
    }
    if (!this._index) throw new Error('Hydration.preview: index must be set');
    if (!oneId) throw new Error('Hydration.preview: pass an itemId or call .hits([...]) first');
    const endpoint = '/hydration/preview';
    const body = { origin: this._origin, index: this._index, item_id: oneId };
    if (Object.keys(this._targets).length > 0) body.hydrate = this._targets;
    const result = await this._post(endpoint, body);
    this.lastCall = { endpoint, payload: body };
    this.lastResult = result;
    return result.result || result;
  }
  log(string) { this._log(string); }
  show(results) { this._show(results); }
}
