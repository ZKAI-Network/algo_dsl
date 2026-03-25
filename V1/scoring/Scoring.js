export class Scoring {
  _userId = null;
  _itemIds = [];
  _modelEndpoint = null;
  lastCall = null;
  lastResult = null;
  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('Scoring: options object is required');
    }
    const { url, apiKey, userId = null, itemIds = [], origin = 'sdk', log, show } = options;
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Scoring: options.url is required and must be a non-empty string');
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Scoring: options.apiKey is required and must be a non-empty string');
    }
    this._url = url.trim().replace(/\/$/, '');
    this._apiKey = apiKey.trim();
    this._origin = typeof origin === 'string' && origin.trim() ? origin.trim() : 'sdk';
    this._log = typeof log === 'function' ? log : console.log.bind(console);
    this._show = typeof show === 'function' ? show : console.log.bind(console);
    if (userId != null && typeof userId === 'string' && userId.trim()) this._userId = userId.trim();
    if (Array.isArray(itemIds) && itemIds.length > 0) {
      this._itemIds = itemIds.map((id) => (typeof id === 'string' ? id : String(id)));
    }
  }
  getEndpoint() {
    if (!this._modelEndpoint || !this._modelEndpoint.trim()) {
      throw new Error('Scoring.getEndpoint: model endpoint must be set (call model(endpoint) first)');
    }
    return this._modelEndpoint.startsWith('/') ? this._modelEndpoint : `/${this._modelEndpoint}`;
  }
  getPayload() {
    return { origin: this._origin, user_id: this._userId, item_ids: [...this._itemIds] };
  }
  model(endpoint) {
    this._modelEndpoint = endpoint;
    return this;
  }
  userId(userId) {
    this._userId = userId;
    return this;
  }
  itemIds(itemIds) {
    this._itemIds = itemIds;
    return this;
  }
  async execute() {
    if (!this._modelEndpoint || !this._modelEndpoint.trim()) {
      throw new Error('Scoring.execute: model endpoint must be set (call model(endpoint) first)');
    }
    if (!this._userId || typeof this._userId !== 'string' || !this._userId.trim()) {
      throw new Error('Scoring.execute: user_id must be set (pass to constructor or call userId(id))');
    }
    if (!Array.isArray(this._itemIds) || this._itemIds.length === 0) {
      throw new Error('Scoring.execute: item_ids must be set and non-empty (pass to constructor or call itemIds([...]))');
    }
    const endpoint = this.getEndpoint();
    const payload = this.getPayload();
    const url = `${this._url}${endpoint}`;
    this.log(`Sending request to ${url}`);
    const startTime = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this._apiKey}` },
      body: JSON.stringify(payload),
    });
    const frontendTime = Math.round(performance.now() - startTime);
    if (!response.ok) {
      const text = await response.text();
      let message = `Scoring API error: ${response.status} ${response.statusText}`;
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
    if (res === undefined) throw new Error('Scoring.execute: result.result is undefined');
    this._log('Scoring result:');
    this._log(`  took_sdk: ${result.took_sdk}`);
    this._log(`  Array length: ${res.length}`);
    return res;
  }
  log(string) {
    this._log(string);
  }
  show(results) {
    this._show(results);
  }
}
