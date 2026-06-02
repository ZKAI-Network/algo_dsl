/**
 * Notification — a Studio-level subscription that composes 1-N algos into a
 * single webhook delivery surface, gated by guards (daily_budget,
 * cooldown_hours, priority_filter).
 *
 * Usage:
 *   await mbd.notification('daily_trade_alerts')
 *     .algos([algoIdA, algoIdB])
 *     .webhook('https://customer.com/signals', { authBearer: '...' })
 *     .budget({ daily: 20, perType: { whale_move: 3 } })
 *     .cooldown({ hours: 2, by: 'token' })
 *     .priorityFilter('P0,P1')
 *     .activate();
 *
 * Lifecycle methods POST to the deploy service:
 *   .save()      → POST /deploy/notifications  (status=paused)
 *   .activate()  → save (if new) + POST /deploy/notifications/:id/activate
 *   .pause(id?)  → POST /deploy/notifications/:id/pause
 *   .update(id)  → PATCH /deploy/notifications/:id
 *   .preview()   → GET /deploy/notifications/:id/preview
 *   .test(id?)   → POST /deploy/notifications/:id/test
 *   .describe()  → return the would-be POST body (no network)
 */
export class Notification {
  _name = null;
  _algoIds = [];
  _webhook = null;
  _budget = null;
  _cooldown = null;
  _priorityFilter = null;
  _notificationId = null;
  lastCall = null;
  lastResult = null;

  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('Notification: options object is required');
    }
    const { url, apiKey, name, log, show } = options;
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Notification: options.url is required (deploy service base URL)');
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Notification: options.apiKey is required');
    }
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Notification: options.name is required');
    }
    this._url = url.trim().replace(/\/$/, '');
    this._apiKey = apiKey.trim();
    this._name = name.trim();
    this._log = typeof log === 'function' ? log : console.log.bind(console);
    this._show = typeof show === 'function' ? show : console.log.bind(console);
  }

  algos(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('Notification.algos: argument must be a non-empty array of algo ids');
    }
    this._algoIds = ids.map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10)))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (this._algoIds.length === 0) {
      throw new Error('Notification.algos: no valid algo ids supplied');
    }
    return this;
  }

  webhook(url, opts = {}) {
    if (typeof url !== 'string' || !url.startsWith('http')) {
      throw new Error('Notification.webhook: url must be an http(s) URL');
    }
    this._webhook = { webhook_url: url };
    if (opts.authBearer) {
      this._webhook.auth_header = `Bearer ${opts.authBearer}`;
    } else if (opts.authHeader) {
      this._webhook.auth_header = String(opts.authHeader);
    }
    return this;
  }

  budget({ daily, perType } = {}) {
    this._budget = {};
    if (daily != null) this._budget.daily_budget = Number(daily);
    if (perType && typeof perType === 'object') this._budget.per_type_limits = perType;
    return this;
  }

  cooldown({ hours, by } = {}) {
    this._cooldown = {};
    if (hours != null) this._cooldown.cooldown_hours = Number(hours);
    if (by != null) this._cooldown.cooldown_by = String(by);
    return this;
  }

  priorityFilter(value) {
    this._priorityFilter = String(value);
    return this;
  }

  /** Compose the body the deploy service expects. */
  getPayload() {
    const guards = { ...(this._budget || {}), ...(this._cooldown || {}) };
    if (this._priorityFilter) guards.priority_filter = this._priorityFilter;
    return {
      name: this._name,
      algo_ids: this._algoIds,
      delivery: this._webhook || {},
      guards,
    };
  }

  describe() {
    return this.getPayload();
  }

  async _request(path, method = 'GET', body = null) {
    const url = `${this._url}${path}`;
    const init = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this._apiKey}` },
    };
    if (body != null) init.body = JSON.stringify(body);
    this._log(`${method} ${url}`);
    const response = await fetch(url, init);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Notification ${method} ${path} → ${response.status}: ${text}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  /** POST /deploy/notifications — create (status=paused). */
  async save() {
    const payload = this.getPayload();
    const created = await this._request('/deploy/notifications', 'POST', payload);
    this._notificationId = created?.notification_id ?? null;
    this.lastCall = { endpoint: '/deploy/notifications', payload };
    this.lastResult = created;
    return created;
  }

  /** PATCH /deploy/notifications/:id — partial update. id defaults to the one we last created. */
  async update(notificationId = null) {
    const id = notificationId ?? this._notificationId;
    if (id == null) throw new Error('Notification.update: notificationId required');
    const payload = this.getPayload();
    const updated = await this._request(`/deploy/notifications/${id}`, 'PATCH', payload);
    this._notificationId = updated?.notification_id ?? id;
    this.lastCall = { endpoint: `/deploy/notifications/${id}`, payload };
    this.lastResult = updated;
    return updated;
  }

  /** Save (if new) and POST /activate. */
  async activate() {
    if (this._notificationId == null) await this.save();
    const id = this._notificationId;
    const activated = await this._request(`/deploy/notifications/${id}/activate`, 'POST');
    this.lastResult = activated;
    return activated;
  }

  async pause(notificationId = null) {
    const id = notificationId ?? this._notificationId;
    if (id == null) throw new Error('Notification.pause: notificationId required');
    return this._request(`/deploy/notifications/${id}/pause`, 'POST');
  }

  async preview({ hours = 24, notificationId = null } = {}) {
    const id = notificationId ?? this._notificationId;
    if (id == null) throw new Error('Notification.preview: notificationId required');
    return this._request(`/deploy/notifications/${id}/preview?hours=${hours}`, 'GET');
  }

  async test(notificationId = null) {
    const id = notificationId ?? this._notificationId;
    if (id == null) throw new Error('Notification.test: notificationId required');
    return this._request(`/deploy/notifications/${id}/test`, 'POST');
  }

  log(s) { this._log(s); }
  show(r) { this._show(r); }
}
