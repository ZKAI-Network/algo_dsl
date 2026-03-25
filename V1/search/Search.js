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
    const { url, apiKey, origin = 'sdk', log, show } = options;
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Search: options.url is required and must be a non-empty string');
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Search: options.apiKey is required and must be a non-empty string');
    }
    this._url = url.trim().replace(/\/$/, '');
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
    return res.hits;
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
