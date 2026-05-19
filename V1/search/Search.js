import {
  Filter, TermFilter, TermsFilter, NumericFilter, MatchFilter, GeoFilter, DateFilter,
  IsNullFilter, NotNullFilter, CustomFilter, GroupBoostFilter, TermsLookupFilter, ConsoleAccountFilter,
} from './filters/index.js';

/** Search builder: index(), include()/exclude()/boost(), filters, execute(). Call include/exclude/boost before adding filters. */
export class Search {
  _index = null;
  _es_query = null;
  _size = 100;
  _only_ids = false;
  _include_vector = false;
  _select_fields = null;
  _text = null;
  _vector = null;
  _sort_by = null;
  _include = [];
  _exclude = [];
  _boost = [];
  /** Set by include()/exclude()/boost(); filters are pushed to whichever array is active. */
  _active_array = null;
  lastCall = null;
  lastResult = null;
  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('Search: options object is required');
    }
    const { url, storiesUrl, apiKey, origin = 'sdk', log, show } = options;
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Search: options.url is required and must be a non-empty string');
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Search: options.apiKey is required and must be a non-empty string');
    }
    this._url = url.trim().replace(/\/$/, '');
    this._storiesUrl = typeof storiesUrl === 'string' && storiesUrl.trim()
      ? storiesUrl.trim().replace(/\/$/, '')
      : this._url;
    this._apiKey = apiKey.trim();
    this._origin = typeof origin === 'string' && origin.trim() ? origin.trim() : 'sdk';
    this._log = typeof log === 'function' ? log : console.log.bind(console);
    this._show = typeof show === 'function' ? show : console.log.bind(console);
  }
  /** Endpoint selection: es_query > semantic (text/vector) > boost > filter_and_sort. */
  getEndpoint() {
    if (this._es_query != null) return '/search/es_query';
    const hasTextOrVector = (typeof this._text === 'string' && this._text.length > 0) || (Array.isArray(this._vector) && this._vector.length > 0);
    if (hasTextOrVector) return '/search/semantic';
    if (this._boost.length > 0) return '/search/boost';
    return '/search/filter_and_sort';
  }
  getPayload() {
    const endpoint = this.getEndpoint();
    if (endpoint === '/search/es_query') {
      return { index: this._index, origin: this._origin, feed_type: 'es_query', query: this._es_query };
    }
    const feedType = endpoint === '/search/semantic' ? 'semantic' : endpoint === '/search/boost' ? 'boost' : 'filter_and_sort';
    const serializeFilters = (arr) => arr.map((f) => ({ ...f }));
    const payload = {
      index: this._index,
      origin: this._origin,
      feed_type: feedType,
      include_vector: this._include_vector,
      size: this._size,
      include: serializeFilters(this._include),
      exclude: serializeFilters(this._exclude),
    };
    if (feedType === 'boost') payload.boost = serializeFilters(this._boost);
    if (feedType === 'filter_and_sort' && this._sort_by) payload.sort_by = this._sort_by;
    if (feedType === 'semantic') {
      if (typeof this._text === 'string' && this._text.length > 0) payload.text = this._text;
      if (Array.isArray(this._vector) && this._vector.length > 0) payload.vector = this._vector;
    }
    if (this._only_ids) payload.only_ids = true;
    if (Array.isArray(this._select_fields) && this._select_fields.length > 0) payload.select_fields = this._select_fields;
    return payload;
  }
  async execute() {
    if (!this._index || typeof this._index !== 'string' || !this._index.trim()) {
      throw new Error('Search.execute: index must be set (call index(name) first)');
    }
    if (this._es_query != null && (typeof this._es_query !== 'object' || Array.isArray(this._es_query))) {
      throw new Error('Search.execute: esQuery() must be called with a plain object (e.g. { query: {...}, sort: [...] })');
    }
    const hasOnlyIds = this._only_ids === true;
    const hasSelectFields = Array.isArray(this._select_fields) && this._select_fields.length > 0;
    const hasIncludeVector = this._include_vector === true;
    const exclusiveCount = (hasOnlyIds ? 1 : 0) + (hasSelectFields ? 1 : 0) + (hasIncludeVector ? 1 : 0);
    if (exclusiveCount > 1) {
      throw new Error(
        'Search: onlyIds, selectFields, and includeVectors are mutually exclusive; only one may be set at a time.'
      );
    }
    const endpoint = this.getEndpoint();
    if (endpoint === '/search/es_query') {
      if (this._include.length > 0 || this._exclude.length > 0 || this._boost.length > 0) {
        throw new Error(
          'Search: esQuery() does not support include(), exclude(), or boost() filters. Add filters directly in your Elasticsearch query.'
        );
      }
    } else if (endpoint === '/search/semantic') {
      if (this._include.length > 0 || this._exclude.length > 0 || this._boost.length > 0) {
        throw new Error(
          'Search: semantic search does not support include(), exclude(), or boost() filters. Use filter_and_sort or boost endpoints for filtering.'
        );
      }
      if (this._sort_by != null) {
        throw new Error(
          'Search: semantic search does not support sortBy(). Results are ranked by similarity.'
        );
      }
    } else if (endpoint === '/search/boost') {
      if (this._sort_by != null) {
        throw new Error(
          'Search: boost endpoint does not support sortBy(). Use filter_and_sort for sorting.'
        );
      }
    }
    const payload = this.getPayload();
    const url = `${this._url}${endpoint}`;
    this.log(`Sending request to ${url}`);
    this.log(`Payload:\n${JSON.stringify(payload, null, 2)}`);
    const startTime = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this._apiKey}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = `Search API error: ${response.status} ${response.statusText}`;
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
    const frontendTime = Math.round(performance.now() - startTime);
    result.took_sdk = frontendTime;
    this.lastCall = { endpoint, payload };
    this.lastResult = result;
    if (!result.result) throw new Error('Search.execute: result.result is undefined');
    const res = result.result;
    const infos = {
      total_hits: res?.total_hits ?? 0,
      fetched_hits: res?.hits?.length ?? 0,
      took_es: res?.took_es ?? 0,
      took_backend: res?.took_backend ?? 0,
      took_sdk: result.took_sdk,
      max_score: res?.max_score ?? 0,
    };
    this._log('Search result:');
    this._log(`  total_hits: ${infos.total_hits}`);
    this._log(`  fetched_hits: ${infos.fetched_hits}`);
    this._log(`  took_es: ${infos.took_es}`);
    this._log(`  took_backend: ${infos.took_backend}`);
    this._log(`  took_sdk: ${infos.took_sdk}`);
    this._log(`  max_score: ${infos.max_score}`);
    await this._enrichUserTrades(res.hits);
    return res.hits;
  }
  /**
   * Auto-enrich each hit's `_source` with `user_trades` — a 50/50 mix of
   * "interesting" and "convergence" records normalized to one shape per
   * family (TRADE for token-items, BET for polymarket/kalshi items). The
   * `record_type` field is the only discriminator; the rest of the fields
   * are identical between the two halves so consumers render uniformly.
   *
   * Mirrors `ds_search/backend/candidate_generation/utils/user_trades.py`.
   * Both layers compute the same shape so callers see consistent data
   * whether they go through the SDK or hit /search/* directly.
   *
   * Failures degrade silently: on any HTTP/network error the hits are
   * still returned (with user_trades absent or partial) and a log line
   * is emitted via the SDK's log callback.
   */
  async _enrichUserTrades(hits) {
    if (!Array.isArray(hits) || hits.length === 0) return;
    const index = (this._index || '').trim();
    const conf = this._userTradesConf(index);
    if (!conf) return; // unsupported index — no-op

    const { engine, infosKey, limitKey, lookupKey, family } = conf;
    const params = { [limitKey]: 15 };
    const rowKeyByHitIdx = new Array(hits.length).fill(null);
    const chainAddrByHitIdx = new Array(hits.length).fill(null);
    if (lookupKey === 'id') {
      const itemIds = [];
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (h && typeof h._id === 'string' && h._id) {
          itemIds.push(h._id);
          rowKeyByHitIdx[i] = h._id;
        }
      }
      if (itemIds.length === 0) return;
      params.item_ids = itemIds;
    } else if (lookupKey === 'chain_address') {
      const tokens = [];
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        const src = (h && h._source) || {};
        const chain = String(src.chain || '').trim().toLowerCase();
        const addr = String(src.token_address || '').trim().toLowerCase();
        if (chain && addr) {
          tokens.push({ chain, address: addr });
          rowKeyByHitIdx[i] = `TOKEN#${chain}#${addr}#METADATA`;
          chainAddrByHitIdx[i] = [chain, addr];
        }
      }
      if (tokens.length === 0) return;
      params.tokens = tokens;
    } else {
      return;
    }

    const t0 = performance.now();
    const data = await this._postStories(engine, params);
    if (!data) return;
    const infos = (data && data[infosKey]) || {};

    let notificationsByToken = new Map();
    if (family === 'trade') {
      const uniqueAddrs = new Set();
      for (const ca of chainAddrByHitIdx) {
        if (ca) uniqueAddrs.add(ca[1]);
      }
      notificationsByToken = await this._fetchDexNotificationsFor(
        Array.from(uniqueAddrs),
        15,
      );
    }

    let attached = 0;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (!h || typeof h !== 'object') continue;
      if (!h._source || typeof h._source !== 'object') h._source = {};
      const info = infos[rowKeyByHitIdx[i]] || {};
      let mixed;
      if (family === 'bet') {
        const rawBets = Array.isArray(info.bets) ? info.bets : [];
        const rawCbets = Array.isArray(info.convergence_bets) ? info.convergence_bets : [];
        const interesting = rawBets.map((b) => mapInterestingBet(b));
        const convergence = rawCbets
          .map((cb) => mapConvergenceBet(cb, rowKeyByHitIdx[i]))
          .filter((x) => x);
        mixed = mix5050(interesting, convergence, 15);
      } else {
        const rawTrades = Array.isArray(info.interesting_trades)
          ? info.interesting_trades
          : [];
        const ca = chainAddrByHitIdx[i];
        const rawNotifs = ca ? notificationsByToken.get(`${ca[0]}::${ca[1]}`) || [] : [];
        const interesting = rawTrades.map((t) => mapInterestingTrade(t));
        const convergence = rawNotifs
          .map((n) => mapConvergenceTrade(n))
          .filter((x) => x);
        mixed = mix5050(interesting, convergence, 15);
      }
      h._source.user_trades = mixed;
      if (mixed.length > 0) attached++;
    }
    const ms = Math.round(performance.now() - t0);
    this._log(`user_trades enriched ${attached}/${hits.length} hits via ${engine} (family=${family}) in ${ms}ms`);
  }

  _userTradesConf(index) {
    if (index.startsWith('polymarket-items')) {
      return { engine: 'polymarket_v3', infosKey: 'market_infos', limitKey: 'bet_limit', lookupKey: 'id', family: 'bet' };
    }
    if (index.startsWith('kalshi-items')) {
      return { engine: 'kalshi_v1', infosKey: 'market_infos', limitKey: 'bet_limit', lookupKey: 'id', family: 'bet' };
    }
    if (index.startsWith('token-items')) {
      return { engine: 'token_items_v1', infosKey: 'item_infos', limitKey: 'trade_limit', lookupKey: 'chain_address', family: 'trade' };
    }
    return null;
  }

  async _postStories(engine, params) {
    const url = `${this._storiesUrl}/stories/generate`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this._apiKey}` },
        body: JSON.stringify({ engine, params }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this._log(`user_trades stories call skipped (HTTP ${response.status}): ${text.slice(0, 200)}`);
        return null;
      }
      return await response.json();
    } catch (err) {
      this._log(`user_trades stories call failed: ${err && err.message ? err.message : err}`);
      return null;
    }
  }

  async _fetchDexNotificationsFor(addresses, perTokenLimit) {
    const out = new Map();
    if (!addresses || addresses.length === 0) return out;
    try {
      const payload = {
        index: 'alpha-notifications-dex',
        origin: this._origin,
        feed_type: 'filter_and_sort',
        size: 100 * perTokenLimit,
        include: [{ filter: 'terms', field: 'token_address', value: addresses }],
        exclude: [],
        sort_by: { field: 'timestamp', order: 'desc' },
      };
      const response = await fetch(`${this._url}/search/filter_and_sort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this._apiKey}` },
        body: JSON.stringify(payload),
      });
      if (!response.ok) return out;
      const data = await response.json();
      const hits = (data?.result?.hits) || [];
      for (const h of hits) {
        const src = h?._source || {};
        const chain = String(src.chain || '').toLowerCase();
        const addr = String(src.token_address || '').toLowerCase();
        if (!chain || !addr) continue;
        const key = `${chain}::${addr}`;
        const bucket = out.get(key) || [];
        if (bucket.length < perTokenLimit) {
          bucket.push(src);
          out.set(key, bucket);
        }
      }
    } catch (err) {
      this._log(`user_trades dex-notifications query failed: ${err && err.message ? err.message : err}`);
    }
    return out;
  }
  async frequentValues(field, size = 25) {
    if (!this._index || typeof this._index !== 'string' || !this._index.trim()) {
      throw new Error('Search.frequentValues: index must be set (call index(name) first)');
    }
    if (typeof field !== 'string' || !field.trim()) {
      throw new Error('Search.frequentValues: field must be a non-empty string');
    }
    const n = Number(size);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error('Search.frequentValues: size must be a positive integer');
    }
    const endpoint = `/search/frequent_values/${encodeURIComponent(this._index)}/${encodeURIComponent(field.trim())}?size=${n}`;
    const url = `${this._url}${endpoint}`;
    this.log(`GET ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this._apiKey}` },
    });
    if (!response.ok) {
      const text = await response.text();
      let message = `Search frequentValues error: ${response.status} ${response.statusText}`;
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
    return result;
  }
  async lookup(docId) {
    if (!this._index || typeof this._index !== 'string' || !this._index.trim()) {
      throw new Error('Search.lookup: index must be set (call index(name) first)');
    }
    if (typeof docId !== 'string' || !docId.trim()) {
      throw new Error('Search.lookup: docId must be a non-empty string');
    }
    const endpoint = `/search/document/${encodeURIComponent(this._index)}/${encodeURIComponent(docId.trim())}`;
    const url = `${this._url}${endpoint}`;
    this.log(`GET ${url}`);
    const startTime = performance.now();
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this._apiKey}` },
    });
    const frontendTime = Math.round(performance.now() - startTime);
    if (!response.ok) {
      const text = await response.text();
      let message = `Search lookup error: ${response.status} ${response.statusText}`;
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
    result.took_frontend = frontendTime;
    this.lastCall = { endpoint, payload: null };
    this.lastResult = result;
    return result;
  }
  index(selected_index) {
    if (typeof selected_index !== 'string' || !selected_index.trim()) {
      throw new Error('Search.index: selected_index must be a non-empty string');
    }
    this._index = selected_index.trim();
    return this;
  }
  size(size) {
    const n = Number(size);
    if (!Number.isInteger(n) || n <= 0 || n >= 2000) {
      throw new Error('Search.size: size must be an integer > 0 and < 2000');
    }
    this._size = n;
    return this;
  }
  onlyIds(value) {
    this._only_ids = value == null ? true : Boolean(value);
    return this;
  }
  includeVectors(value) {
    this._include_vector = value == null ? true : Boolean(value);
    return this;
  }
  selectFields(fields) {
    if (fields === null) {
      this._select_fields = null;
      return this;
    }
    if (!Array.isArray(fields)) throw new Error('Search.selectFields: fields must be an array of strings or null');
    const normalized = fields.map((f) => (typeof f === 'string' ? f.trim() : String(f)));
    if (normalized.some((f) => !f)) throw new Error('Search.selectFields: each field must be a non-empty string');
    this._select_fields = normalized;
    return this;
  }
  text(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Search.text: text must be a non-empty string');
    this._text = text.trim();
    return this;
  }
  vector(vector) {
    if (!Array.isArray(vector)) throw new Error('Search.vector: vector must be an array of numbers');
    this._vector = vector;
    return this;
  }
  esQuery(rawQuery) {
    if (rawQuery == null || typeof rawQuery !== 'object' || Array.isArray(rawQuery)) {
      throw new Error('Search.esQuery: rawQuery must be a plain object');
    }
    this._es_query = rawQuery;
    return this;
  }
  sortBy(field, direction = 'desc') {
    if (typeof field !== 'string' || !field.trim()) throw new Error('Search.sortBy: field must be a non-empty string');
    if (direction !== 'asc' && direction !== 'desc') throw new Error('Search.sortBy: direction must be "asc" or "desc"');
    this._sort_by = { field: field.trim(), order: direction };
    return this;
  }
  include() {
    this._active_array = this._include;
    return this;
  }
  exclude() {
    this._active_array = this._exclude;
    return this;
  }
  boost() {
    this._active_array = this._boost;
    return this;
  }
  _requireActiveArray() {
    if (this._active_array === null) throw new Error('Search: call include(), exclude(), or boost() before adding filters');
  }
  _requireBoostForBoostArray(boost) {
    if (this._active_array === this._boost && boost == null) {
      throw new Error('Search: when adding to boost array, a non-null boost is required');
    }
  }
  filter(filterInstance) {
    this._requireActiveArray();
    if (filterInstance == null || !(filterInstance instanceof Filter)) {
      throw new Error('Search.filter: argument must be a Filter instance');
    }
    if (this._active_array === this._boost && filterInstance.filter !== 'group_boost' && filterInstance.boost == null) {
      throw new Error('Search: when adding to boost array, the filter must have a non-null boost (group_boost is exempt)');
    }
    this._active_array.push(filterInstance);
    return this;
  }
  term(field, value, boost = null) {
    this._requireActiveArray();
    this._requireBoostForBoostArray(boost);
    this._active_array.push(new TermFilter(field, value, boost));
    return this;
  }
  terms(field, values, boost = null) {
    this._requireActiveArray();
    this._requireBoostForBoostArray(boost);
    this._active_array.push(new TermsFilter(field, values, boost));
    return this;
  }
  numeric(field, operator, value, boost = null) {
    this._requireActiveArray();
    this._requireBoostForBoostArray(boost);
    this._active_array.push(new NumericFilter(field, operator, value, boost));
    return this;
  }
  date(field, dateFrom = null, dateTo = null, boost = null) {
    this._requireActiveArray();
    this._requireBoostForBoostArray(boost);
    this._active_array.push(new DateFilter(field, dateFrom, dateTo, boost));
    return this;
  }
  geo(field, value, boost = null) {
    this._requireActiveArray();
    this._requireBoostForBoostArray(boost);
    this._active_array.push(new GeoFilter(field, value, boost));
    return this;
  }
  match(field, value, boost = null) {
    this._requireActiveArray();
    this._requireBoostForBoostArray(boost);
    this._active_array.push(new MatchFilter(field, value, boost));
    return this;
  }
  isNull(field, boost = null) {
    this._requireActiveArray();
    this._requireBoostForBoostArray(boost);
    this._active_array.push(new IsNullFilter(field, boost));
    return this;
  }
  notNull(field, boost = null) {
    this._requireActiveArray();
    this._requireBoostForBoostArray(boost);
    this._active_array.push(new NotNullFilter(field, boost));
    return this;
  }
  custom(field, value, boost = null) {
    this._requireActiveArray();
    this._requireBoostForBoostArray(boost);
    this._active_array.push(new CustomFilter(field, value, boost));
    return this;
  }
  groupBoost(lookup_index, field, value, group, min_boost = null, max_boost = null, n = null) {
    this._requireActiveArray();
    this._active_array.push(new GroupBoostFilter(lookup_index, field, value, group, min_boost, max_boost, n));
    return this;
  }
  termsLookup(lookup_index, field, value, path, boost = null) {
    this._requireActiveArray();
    this._requireBoostForBoostArray(boost);
    this._active_array.push(new TermsLookupFilter(lookup_index, field, value, path, boost));
    return this;
  }
  consoleAccount(field, value, path, boost = null) {
    this._requireActiveArray();
    this._requireBoostForBoostArray(boost);
    this._active_array.push(new ConsoleAccountFilter(field, value, path, boost));
    return this;
  }
  log(string) {
    this._log(string);
  }
  show(results) {
    this._show(results);
  }
}


// --- user_trades helpers (canonical schemas, mix algorithm) ----------------
function isoToEpochS(s) {
  if (typeof s !== 'string' || !s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.floor(t / 1000);
}

function mapInterestingTrade(t) {
  if (!t || typeof t !== 'object') return null;
  return { ...t, record_type: 'interesting_trade' };
}

function mapConvergenceTrade(n) {
  if (!n || typeof n !== 'object') return null;
  const notifType = String(n.notification_type || '').toLowerCase();
  const direction = notifType.includes('sell') ? 'sell' : 'buy';
  const ts = n.timestamp || n.created_at;
  let epoch = null;
  if (typeof ts === 'string') epoch = isoToEpochS(ts);
  else if (typeof ts === 'number') epoch = Math.floor(ts);
  const wallets = Array.isArray(n.trader_wallets) ? n.trader_wallets : [];
  return {
    record_type: 'convergence_trade',
    amount_usd: n.total_usd_inflow ?? null,
    block_timestamp: epoch,
    chain: n.chain ?? null,
    direction,
    project: n.cta_action ?? null,
    protocol: n.signal_type ?? null,
    token_address: n.token_address ?? null,
    tx_hash: null,
    wallet_24h_volume_usd: null,
    wallet_address: wallets[0] ?? null,
  };
}

function mapInterestingBet(b) {
  if (!b || typeof b !== 'object') return null;
  return { ...b, record_type: 'interesting_bet' };
}

function mapConvergenceBet(cb, marketId) {
  if (!cb || typeof cb !== 'object') return null;
  return {
    record_type: 'convergence_bet',
    event: 'TRADE',
    id: cb.signal_id ?? null,
    item_id: marketId ?? null,
    outcome: cb.outcome_label ?? null,
    price: null,
    shares: null,
    side: cb.direction ?? null,
    timestamp: cb.traded_at ?? null,
    usdc: cb.size_usd ?? null,
    user_id: cb.wallet ?? null,
    user_name: null,
    user_pfp: null,
    user_pseudonym: null,
    user_pnl: cb.realized_pnl_usd ?? null,
    user_volume: null,
  };
}

function mix5050(interesting, convergence, limit) {
  const half = Math.floor(limit / 2);
  const odd = limit - 2 * half;
  let takeI = Math.min(interesting.length, half + odd);
  let takeC = Math.min(convergence.length, half);
  let deficit = limit - takeI - takeC;
  if (deficit > 0) {
    const extra = Math.min(deficit, interesting.length - takeI);
    takeI += extra;
    deficit -= extra;
  }
  if (deficit > 0) {
    const extra = Math.min(deficit, convergence.length - takeC);
    takeC += extra;
  }
  return interesting.slice(0, takeI).concat(convergence.slice(0, takeC));
}
