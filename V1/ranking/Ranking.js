export class Ranking {
  _candidates = [];
  _sortMethod = 'sort';
  _sortParams = null;
  _diversityMethod = null;
  _diversityParams = null;
  _limitsByFieldEnabled = false;
  _everyN = 10;
  _limitRules = [];
  lastCall = null;
  lastResult = null;
  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('Ranking: options object is required');
    }
    const { url, apiKey, candidates = [], origin = 'sdk', log, show } = options;
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Ranking: options.url is required and must be a non-empty string');
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Ranking: options.apiKey is required and must be a non-empty string');
    }
    this._url = url.trim().replace(/\/$/, '');
    this._apiKey = apiKey.trim();
    this._origin = typeof origin === 'string' && origin.trim() ? origin.trim() : 'sdk';
    this._log = typeof log === 'function' ? log : console.log.bind(console);
    this._show = typeof show === 'function' ? show : console.log.bind(console);
    this._candidates = candidates;
  }
  getEndpoint() {
    return '/ranking/feed';
  }
  /** Collects fields referenced by sort/diversity/limits; sets needEmbedding for semantic diversity. */
  _getUsefulFieldsAndNeedEmbedding() {
    const useful = new Set();
    let needEmbedding = false;
    if (this._sortParams) {
      if (this._sortMethod === 'sort' && Array.isArray(this._sortParams.fields)) {
        this._sortParams.fields.forEach((f) => useful.add(f));
      }
      if (this._sortMethod === 'linear' && Array.isArray(this._sortParams)) {
        this._sortParams.forEach((p) => p.field && useful.add(p.field));
      }
      if (this._sortMethod === 'mix' && Array.isArray(this._sortParams)) {
        this._sortParams.forEach((p) => p.field && useful.add(p.field));
      }
    }
    if (this._diversityMethod === 'fields' && this._diversityParams?.fields) {
      this._diversityParams.fields.forEach((f) => useful.add(f));
    }
    if (this._diversityMethod === 'semantic') needEmbedding = true;
    if (this._limitsByFieldEnabled && this._limitRules.length > 0) {
      this._limitRules.forEach((r) => r.field && useful.add(r.field));
    }
    return { usefulFields: useful, needEmbedding };
  }
  /** Builds items from hit._features, hit._scores; adds embed (item_sem_embed2 or text_vector) if semantic diversity. */
  getPayload() {
    const { usefulFields, needEmbedding } = this._getUsefulFieldsAndNeedEmbedding();
    const hits = this._candidates || [];
    const items = hits.map((hit) => {
      const item = { item_id: hit._id };
      for (const key of usefulFields) {
        const v = hit._features?.[key] ?? hit._scores?.[key];
        if (v !== undefined) item[key] = v;
      }
      if (needEmbedding) {
        let embed = hit._source?.item_sem_embed2;
        if (!embed || !Array.isArray(embed)) embed = hit._source?.text_vector;
        if (embed) item.embed = embed;
      }
      return item;
    });
    const payload = { origin: this._origin, items };
    const sortConfig = this._buildSortConfig();
    if (sortConfig) payload.sort = sortConfig;
    const diversityConfig = this._buildDiversityConfig();
    if (diversityConfig) payload.diversity = diversityConfig;
    const limitsByFieldConfig = this._buildLimitsByFieldConfig();
    if (limitsByFieldConfig) payload.limits_by_field = limitsByFieldConfig;
    return payload;
  }
  _buildSortConfig() {
    if (!this._sortParams) return undefined;
    if (this._sortMethod === 'sort' && this._sortParams.fields?.length > 0) {
      return { method: 'sort', params: { ...this._sortParams } };
    }
    if (this._sortMethod === 'linear' && Array.isArray(this._sortParams) && this._sortParams.length > 0) {
      return { method: 'linear', params: this._sortParams.map((p) => ({ field: p.field, weight: p.weight })) };
    }
    if (this._sortMethod === 'mix' && Array.isArray(this._sortParams) && this._sortParams.length > 0) {
      return { method: 'mix', params: this._sortParams.map((p) => ({ field: p.field, direction: p.direction, percentage: p.percentage })) };
    }
    return undefined;
  }
  _buildDiversityConfig() {
    if (!this._diversityMethod) return undefined;
    if (this._diversityMethod === 'fields' && this._diversityParams?.fields?.length > 0) {
      return { method: 'fields', params: { fields: [...this._diversityParams.fields] } };
    }
    if (this._diversityMethod === 'semantic') {
      const lambda = this._diversityParams?.lambda ?? 0.5;
      const horizon = this._diversityParams?.horizon ?? 20;
      return { method: 'semantic', params: { lambda: Number(lambda), horizon: Number(horizon) } };
    }
    return undefined;
  }
  _buildLimitsByFieldConfig() {
    if (!this._limitsByFieldEnabled || !this._limitRules.length) return undefined;
    const everyN = Number(this._everyN);
    if (!Number.isInteger(everyN) || everyN < 2) return undefined;
    return { every_n: everyN, rules: this._limitRules.map((r) => ({ field: r.field, limit: Number(r.limit) || 0 })) };
  }
  sortingMethod(x) {
    if (x !== 'sort' && x !== 'linear' && x !== 'mix') {
      throw new Error('Ranking.sortingMethod: must be "sort", "linear", or "mix"');
    }
    this._sortMethod = x;
    if (x === 'sort') this._sortParams = { fields: [], direction: [] };
    if (x === 'linear') this._sortParams = [];
    if (x === 'mix') this._sortParams = [];
    return this;
  }
  sortBy(field, direction = 'desc', field2, direction2 = 'desc') {
    if (this._sortMethod === 'linear' || this._sortMethod === 'mix') {
      throw new Error('Ranking.sortBy: only applies when sortingMethod is "sort" (already set to something else)');
    }
    this._sortMethod = 'sort';
    if (!this._sortParams || !this._sortParams.fields) this._sortParams = { fields: [], direction: [] };
    const f = typeof field === 'string' && field.trim() ? field.trim() : null;
    if (!f) throw new Error('Ranking.sortBy: field must be a non-empty string');
    if (direction !== 'asc' && direction !== 'desc') throw new Error('Ranking.sortBy: direction must be "asc" or "desc"');
    this._sortParams = { fields: [f], direction: [direction] };
    if (typeof field2 === 'string' && field2.trim()) {
      this._sortParams.fields.push(field2.trim());
      this._sortParams.direction.push(direction2 === 'asc' ? 'asc' : 'desc');
    }
    return this;
  }
  weight(field, w) {
    if (this._sortMethod !== 'linear') throw new Error('Ranking.weight: only applies when sortingMethod is "linear"');
    const f = typeof field === 'string' && field.trim() ? field.trim() : null;
    if (!f) throw new Error('Ranking.weight: field must be a non-empty string');
    if (!Array.isArray(this._sortParams)) this._sortParams = [];
    this._sortParams.push({ field: f, weight: Number(w) });
    return this;
  }
  mix(field, direction, percentage) {
    if (this._sortMethod === 'linear') throw new Error('Ranking.mix: only applies when sortingMethod is "mix" (already set to "linear")');
    this._sortMethod = 'mix';
    if (!Array.isArray(this._sortParams)) this._sortParams = [];
    const f = typeof field === 'string' && field.trim() ? field.trim() : null;
    if (!f) throw new Error('Ranking.mix: field must be a non-empty string');
    if (direction !== 'asc' && direction !== 'desc') throw new Error('Ranking.mix: direction must be "asc" or "desc"');
    this._sortParams.push({ field: f, direction, percentage: Number(percentage) || 0 });
    return this;
  }
  diversity(method) {
    if (method !== 'fields' && method !== 'semantic') throw new Error('Ranking.diversity: method must be "fields" or "semantic"');
    this._diversityMethod = method;
    if (method === 'fields') this._diversityParams = { fields: [] };
    if (method === 'semantic') this._diversityParams = { lambda: 0.5, horizon: 20 };
    return this;
  }
  fields(arrayOrItem) {
    if (this._diversityMethod !== 'fields') throw new Error('Ranking.fields: only applies when diversity(method) is "fields"');
    if (!this._diversityParams || !Array.isArray(this._diversityParams.fields)) this._diversityParams = { fields: [] };
    const add = (name) => {
      const s = typeof name === 'string' && name.trim() ? name.trim() : null;
      if (s && !this._diversityParams.fields.includes(s)) this._diversityParams.fields.push(s);
    };
    if (Array.isArray(arrayOrItem)) arrayOrItem.forEach(add);
    else add(arrayOrItem);
    return this;
  }
  horizon(n) {
    if (this._diversityMethod !== 'semantic') throw new Error('Ranking.horizon: only applies when diversity(method) is "semantic"');
    if (!this._diversityParams) this._diversityParams = { lambda: 0.5, horizon: 20 };
    this._diversityParams.horizon = Number(n);
    return this;
  }
  lambda(value) {
    if (this._diversityMethod !== 'semantic') throw new Error('Ranking.lambda: only applies when diversity(method) is "semantic"');
    if (!this._diversityParams) this._diversityParams = { lambda: 0.5, horizon: 20 };
    this._diversityParams.lambda = Number(value);
    return this;
  }
  limitByField() {
    this._limitsByFieldEnabled = true;
    return this;
  }
  every(n) {
    this._everyN = Number(n);
    return this;
  }
  limit(field, max) {
    const f = typeof field === 'string' && field.trim() ? field.trim() : null;
    if (!f) throw new Error('Ranking.limit: field must be a non-empty string');
    const existing = this._limitRules.find((r) => r.field === f);
    if (existing) existing.limit = Number(max) || 0;
    else this._limitRules.push({ field: f, limit: Number(max) || 0 });
    return this;
  }
  candidates(candidates) {
    this._candidates = candidates;
    return this;
  }
  async execute() {
    if (!Array.isArray(this._candidates) || this._candidates.length === 0) {
      throw new Error('Ranking.execute: candidates must be set and non-empty (pass to constructor or call candidates([...]))');
    }
    const sortConfig = this._buildSortConfig();
    if (!sortConfig) {
      throw new Error('Ranking.execute: at least one sort configuration is required (e.g. sortingMethod("sort").sortBy("field", "desc"))');
    }
    const endpoint = this.getEndpoint();
    const payload = this.getPayload();
    const url = `${this._url}${endpoint}`;
    this.log(`Sending request to ${url}`);
    const { items, ...rest } = payload;
    const logPayload = { ...rest, items_length: Array.isArray(items) ? items.length : 0 };
    this.log(`Payload:\n${JSON.stringify(logPayload, null, 2)}`);
    const startTime = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this._apiKey}` },
      body: JSON.stringify(payload),
    });
    const frontendTime = Math.round(performance.now() - startTime);
    if (!response.ok) {
      const text = await response.text();
      let message = `Ranking API error: ${response.status} ${response.statusText}`;
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
    this.lastCall = { endpoint, payload };
    this.lastResult = result;
    const res = result.result;
    if (!res) throw new Error('Ranking.execute: response result is undefined');
    const resultItems = res.items || [];
    this._log('Ranking result:');
    this._log(`  took_sdk_ms: ${result.took_sdk}`);
    this._log(`  items: ${resultItems.length}`);
    return res;
  }
  log(string) {
    this._log(string);
  }
  show(results) {
    this._show(results);
  }
}
