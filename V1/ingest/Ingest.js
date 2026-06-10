/**
 * Ingest — customer overlay on top of alpha's `sources.yaml`. Lets a
 * customer pick an alpha preset (e.g. 'hyperliquid'), tune existing
 * signal_types' kwargs, disable defaults they don't want, and add
 * brand-new signal_types that reference detectors alpha already
 * ships. The DSL is config-only — no customer code runs server-side.
 *
 * The shape of the captured spec mirrors what alpha already loads
 * from sources.yaml:
 *   {
 *     preset: 'hyperliquid',
 *     tune: { convergence: { p0_threshold: 8 } },
 *     disable: ['whale_move'],
 *     custom_signals: {
 *       top_trader_converge: {
 *         detector: 'convergence',
 *         p0_threshold: 3,
 *         wallet_filter: ['0xabc', '0xdef'],
 *       },
 *     },
 *     write_to: 'alpha',
 *   }
 *
 * Usage:
 *   mbd.ingest('my_smart_money')
 *     .preset('hyperliquid')
 *     .tune('convergence', { p0_threshold: 8 })
 *     .disable('whale_move')
 *     .signal('top_trader_converge', {
 *       detector: 'convergence',
 *       p0_threshold: 3,
 *       wallet_filter: ['0xabc', '0xdef'],
 *     })
 *     .writeTo('alpha')
 *     .execute();
 *
 * In 'normal' mode .execute() POSTs to /deploy/ingests. In 'match'
 * mode (push worker introspection) it short-circuits and captures
 * the spec into config.captures.ingests[].
 */

const VALID_WRITE_TO = ['alpha', 'customer'];

function _isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export class Ingest {
  _name = null;
  _preset = null;
  _tune = {};
  _disable = new Set();
  _customSignals = {};
  _writeTo = 'alpha';
  lastCall = null;
  lastResult = null;

  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('Ingest: options object is required');
    }
    const { url, apiKey, name, mode, captures, log, show } = options;
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Ingest: options.name is required');
    }
    // url + apiKey only needed in 'normal' mode (real POST). In 'match' mode
    // we capture to config.captures.ingests[] and never touch the network.
    this._url = typeof url === 'string' ? url.trim().replace(/\/$/, '') : null;
    this._apiKey = typeof apiKey === 'string' ? apiKey.trim() : null;
    this._name = name.trim();
    this._mode = mode === 'match' ? 'match' : 'normal';
    this._captures = captures || null;
    this._log = typeof log === 'function' ? log : console.log.bind(console);
    this._show = typeof show === 'function' ? show : console.log.bind(console);
  }

  /** Pick one of alpha's sources.yaml keys. Required. */
  preset(key) {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('Ingest.preset: key must be a non-empty string');
    }
    this._preset = key.trim();
    return this;
  }

  /** Override kwargs for a default signal_type that alpha already runs. */
  tune(signalName, overrides) {
    if (typeof signalName !== 'string' || !signalName.trim()) {
      throw new Error('Ingest.tune: signalName must be a non-empty string');
    }
    if (!_isPlainObject(overrides)) {
      throw new Error('Ingest.tune: overrides must be a plain object');
    }
    this._tune[signalName.trim()] = { ...overrides };
    return this;
  }

  /** Turn off a default signal_type for this account. */
  disable(signalName) {
    if (typeof signalName !== 'string' || !signalName.trim()) {
      throw new Error('Ingest.disable: signalName must be a non-empty string');
    }
    this._disable.add(signalName.trim());
    return this;
  }

  /** Add a new signal_type that references a detector alpha already
   * ships. `spec.detector` is required; remaining keys are detector
   * kwargs validated server-side.
   */
  signal(signalName, spec) {
    if (typeof signalName !== 'string' || !signalName.trim()) {
      throw new Error('Ingest.signal: signalName must be a non-empty string');
    }
    if (!_isPlainObject(spec)) {
      throw new Error('Ingest.signal: spec must be a plain object');
    }
    if (typeof spec.detector !== 'string' || !spec.detector.trim()) {
      throw new Error('Ingest.signal: spec.detector is required');
    }
    this._customSignals[signalName.trim()] = { ...spec, detector: spec.detector.trim() };
    return this;
  }

  /** Where matching docs land. 'alpha' (default) writes to the same
   * alpha-notifications-* index alpha already targets for this preset.
   * 'customer' additionally writes to customer-<account_id>-<name>.
   */
  writeTo(target) {
    if (!VALID_WRITE_TO.includes(target)) {
      throw new Error(`Ingest.writeTo: target must be one of ${VALID_WRITE_TO.join(', ')}`);
    }
    this._writeTo = target;
    return this;
  }

  /** Return the canonicalized spec without persisting. Useful for
   * tests and for the frontend's "preview the diff" panel.
   */
  describe() {
    if (!this._preset) {
      throw new Error('Ingest.describe: preset() is required before describe()');
    }
    return {
      name: this._name,
      preset: this._preset,
      tune: { ...this._tune },
      disable: [...this._disable].sort(),
      custom_signals: { ...this._customSignals },
      write_to: this._writeTo,
    };
  }

  async execute() {
    const spec = this.describe();
    if (this._mode === 'match') {
      // Match mode: push worker is introspecting the algo. Capture
      // the spec and short-circuit. No network call.
      if (this._captures && Array.isArray(this._captures.ingests)) {
        this._captures.ingests.push(spec);
      } else if (this._captures) {
        this._captures.ingests = [spec];
      }
      this.lastResult = { captured: true, spec };
      return this.lastResult;
    }

    // Normal mode: POST to deploy service.
    if (!this._url) {
      throw new Error('Ingest.execute: deployService URL not configured');
    }
    if (!this._apiKey) {
      throw new Error('Ingest.execute: apiKey not configured');
    }
    const url = `${this._url}/deploy/ingests`;
    // Server expects `{ name, algorithm?, spec: {...} }`. describe()
    // returns the flat shape with `name` mixed in for caller convenience;
    // pull it back out and nest under `spec`.
    const { name: specName, ...specBody } = spec;
    const body = JSON.stringify({ name: specName, spec: specBody });
    this.lastCall = { url, body };
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._apiKey}`,
      },
      body,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Ingest.execute: HTTP ${response.status} ${result?.error || ''}`.trim());
    }
    this.lastResult = result;
    return result;
  }
}
