/** Hydration builder: per-hit metadata I/O as a first-class pipeline stage.
 *
 * Use (pipeline mode):
 *   const out = await mbd.hydration()
 *     .target('user_trades', { sources: [{ plugin: 'polymarket_convergence_bets' }], limit: 10 })
 *     .execute();
 *   mbd.addHydration(out);
 *
 * Or standalone (no candidates needed):
 *   const out = await mbd.hydration()
 *     .index('polymarket-items')
 *     .hits([{ _id: '1706788', _source: { item_id: '1706788' } }])
 *     .target('user_trades', { sources: [{ plugin: 'polymarket_convergence_bets' }] })
 *     .execute();
 *
 * The builder posts the **full hits** to the server. The server looks up
 * each hit's `_source.item_id` (falling back to `_id`), runs the configured
 * plugins, and writes the result onto `_source.metadata.<target>` (and
 * legacy `_source.<target>` during the 0.5.x dual-write window). Foreign
 * fields on the hit (e.g. `_features`, `_scores`) are preserved.
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
    const { url, apiKey, index = null, hits = [], origin = 'sdk', log, show } = options;
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
  }

  /** Override the index (default: pulled from candidates by Studio). */
  index(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Hydration.index: name must be a non-empty string');
    }
    this._index = name.trim();
    return this;
  }

  /** Override the input hits (default: pulled from candidates by Studio). */
  hits(arr) {
    if (!Array.isArray(arr)) {
      throw new Error('Hydration.hits: argument must be an array of hit objects');
    }
    this._hits = arr.filter((h) => h && typeof h === 'object');
    return this;
  }

  /** Convenience: build minimal hits from a list of item_ids. Useful when the
   * caller only has ids on hand (e.g. a curated debug list). */
  itemIds(ids) {
    if (!Array.isArray(ids)) {
      throw new Error('Hydration.itemIds: ids must be an array of strings');
    }
    this._hits = ids
      .filter((x) => typeof x === 'string' && x)
      .map((id) => ({ _index: this._index, _id: id, _source: { item_id: id } }));
    return this;
  }

  /** Configure one hydration target. Call multiple times for multiple targets.
   *
   * The user-facing path is:
   *   .target('user_trades', { limit: 15, drop_empty: true })
   * The server resolves which plugins back the target name based on the
   * current index. Names are bare (e.g. 'user_trades'); the server writes
   * under `_source.metadata.<name>` (with a legacy dual-write to
   * `_source.<name>` during 0.5.x).
   *
   * Power-user override — explicit sources are still accepted:
   *   .target('custom', {
   *     sources: [{ plugin: '...', share: 1.0 }],
   *     limit: 10,
   *     merge: 'mix' | 'pick_one' | 'replace',
   *     drop_empty: true,
   *   })
   * Spec may also omit `spec` entirely; passing `{}` is equivalent to
   * "use server defaults for this target".
   */
  target(name, spec = {}) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Hydration.target: name must be a non-empty string');
    }
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new Error('Hydration.target: spec must be a plain object');
    }
    if (spec.sources !== undefined && !Array.isArray(spec.sources)) {
      throw new Error('Hydration.target: spec.sources must be an array if provided');
    }
    this._targets[name.trim()] = spec;
    return this;
  }

  /** Remove a target previously added via .target(). */
  clearTarget(name) {
    delete this._targets[name];
    return this;
  }

  /** Remove all targets (so .execute() falls back to server defaults). */
  clearTargets() {
    this._targets = {};
    return this;
  }

  /** When true, items whose every requested target is empty are omitted from
   * the response. Useful for "give me only items that have data". */
  dropEmptyHits(value) {
    this._dropEmptyHits = value === undefined ? true : Boolean(value);
    return this;
  }

  getPayload() {
    const payload = {
      origin: this._origin,
      index: this._index,
      hits: this._hits,
    };
    if (Object.keys(this._targets).length > 0) {
      payload.hydrate = this._targets;
    }
    if (this._dropEmptyHits) payload.drop_empty_hits = true;
    return payload;
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

  /** Run hydration. POSTs `/hydration/run` with the configured hits and
   * returns `{hits, stats, took_backend, took_sdk}`. Each returned hit has
   * `_source.metadata.<target>` populated (and legacy `_source.<target>`
   * during the 0.5.x dual-write window). The caller hands this to
   * `mbd.addHydration(result)` which merges the returned hits onto
   * candidates by id. */
  async execute() {
    if (!this._index) {
      throw new Error(
        'Hydration.execute: index must be set (call mbd.hydration() after addCandidates, or .index(name) explicitly)'
      );
    }
    if (!Array.isArray(this._hits) || this._hits.length === 0) {
      throw new Error(
        'Hydration.execute: hits is empty (call mbd.hydration() after addCandidates, or .hits([...]) / .itemIds([...]) explicitly)'
      );
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

  /** Describe — POST `/hydration/describe`. Returns target → family schema +
   * example record without running any source lookup. Cheap, instant. */
  async describe() {
    if (!this._index) {
      throw new Error('Hydration.describe: index must be set');
    }
    const endpoint = '/hydration/describe';
    const body = {
      origin: this._origin,
      index: this._index,
    };
    if (Object.keys(this._targets).length > 0) body.hydrate = this._targets;
    const result = await this._post(endpoint, body);
    this.lastCall = { endpoint, payload: body };
    this.lastResult = result;
    return result.result || result;
  }

  /** Preview — POST `/hydration/preview` with a single item_id and return
   * the populated entry. Useful for "show me real data for one item". */
  async preview(itemId) {
    let oneId = typeof itemId === 'string' && itemId.trim() ? itemId.trim() : null;
    if (!oneId && this._hits.length > 0) {
      const h = this._hits[0];
      oneId = (h._source && h._source.item_id) || h._id || null;
    }
    if (!this._index) {
      throw new Error('Hydration.preview: index must be set');
    }
    if (!oneId) {
      throw new Error('Hydration.preview: pass an itemId or call .hits([...]) first');
    }
    const endpoint = '/hydration/preview';
    const body = {
      origin: this._origin,
      index: this._index,
      item_id: oneId,
    };
    if (Object.keys(this._targets).length > 0) body.hydrate = this._targets;
    const result = await this._post(endpoint, body);
    this.lastCall = { endpoint, payload: body };
    this.lastResult = result;
    return result.result || result;
  }

  log(string) {
    this._log(string);
  }
  show(results) {
    this._show(results);
  }
}
