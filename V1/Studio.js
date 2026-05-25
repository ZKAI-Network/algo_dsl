import { StudioConfig } from '../StudioConfig.js';
import { Search } from './search/Search.js';
import { Features, sortAvailableFeatures } from './features/Features.js';
import { Scoring } from './scoring/Scoring.js';
import { Ranking } from './ranking/Ranking.js';
import { Hydration } from './hydration/Hydration.js';
import { findIndex } from './utils/indexUtils.js';

/** Main client: search, features, scoring, ranking. Use addCandidates() then addFeatures/addScores/addRanking to enrich. */
export class Studio {
  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('Studio: options object is required');
    }
    const { config, apiKey, commonUrl, servicesUrl, log, show, origin } = options;
    this._config = config instanceof StudioConfig ? config : new StudioConfig({ commonUrl, servicesUrl, apiKey });
    this._log = typeof log === 'function' ? log : this._config.log;
    this._show = typeof show === 'function' ? show : this._config.show;
    this._origin = typeof origin === 'string' && origin.trim() ? origin.trim() : 'sdk';
    this._forUser = null;
    this._candidates = [];
  }
  version() {
    return 'V1';
  }
  forUser(index, userId) {
    this._forUser = { index, id: userId };
  }
  search() {
    return new Search({
      url: this._config.searchService,
      storiesUrl: this._config.storiesService,
      apiKey: this._config.apiKey,
      origin: this._origin,
      log: this._log,
      show: this._show,
    });
  }
  async frequentValues(index, field, size = 25) {
    return this.search().index(index).frequentValues(field, size);
  }
  addCandidates(array) {
    this._candidates.push(...array);
  }
  features(version = 'v1') {
    let items = [];
    if (this._candidates && this._candidates.length > 0) {
      items = this._candidates.map((hit) => ({ index: hit._index, id: hit._id }));
    }
    return new Features({
      url: this._config.featuresService,
      apiKey: this._config.apiKey,
      log: this._log,
      show: this._show,
      version,
      items,
      userIndex: this._forUser?.index,
      userId: this._forUser?.id,
      origin: this._origin,
    });
  }
  /** Merges featuresResult (features, scores, info) into hits. Keys use canonical index names (findIndex). */
  addFeatures(featuresResult) {
    const hits = this._candidates || [];
    const features = featuresResult.features;
    const scores = featuresResult.scores;
    const info = featuresResult.info;
    if (!features && !scores && !info) {
      this._log('No features, scores, or info found in featuresResult');
      return;
    }
    let availableFeatures = {};
    let availableScores = {};
    for (const hit of hits) {
      const hitIndex = findIndex(hit._index);
      const hitFeatures = features?.[hitIndex]?.[hit._id];
      const hitScores = scores?.[hitIndex]?.[hit._id];
      const hitInfo = info?.[hitIndex]?.[hit._id];
      if (hit._features) {
        hit._features = { ...hit._features, ...hitFeatures };
      } else {
        hit._features = hitFeatures;
      }
      if (hit._features) {
        for (const [key, value] of Object.entries(hit._features)) {
          if (typeof value === 'number' && !Number.isNaN(value)) availableFeatures[key] = true;
        }
      }
      if (hit._scores) {
        hit._scores = { ...hit._scores, ...hitScores };
      } else {
        hit._scores = hitScores;
      }
      if (hit._scores) {
        for (const [key, value] of Object.entries(hit._scores)) {
          if (typeof value === 'number' && !Number.isNaN(value)) availableScores[key] = true;
        }
      }
      if (hit._info) {
        hit._info = { ...hit._info, ...hitInfo };
      } else {
        hit._info = hitInfo;
      }
    }
    availableFeatures = sortAvailableFeatures(Object.keys(availableFeatures));
    availableScores = sortAvailableFeatures(Object.keys(availableScores));
    this._log(`Available features: ${availableFeatures}`);
    this._log(`Available scores: ${availableScores}`);
  }
  scoring() {
    const userId = this._forUser?.id ?? null;
    const itemIds = Array.isArray(this._candidates) && this._candidates.length > 0
      ? this._candidates.map((c) => (c && (c._id != null) ? String(c._id) : null)).filter(Boolean)
      : [];
    return new Scoring({
      url: this._config.scoringService,
      apiKey: this._config.apiKey,
      log: this._log,
      show: this._show,
      userId,
      itemIds,
      origin: this._origin,
    });
  }
  /** Maps scoring result [{id, score}, ...] into hit._scores[scoringKey]. */
  addScores(scoringResult, scoringKey) {
    if (!this._candidates || !scoringResult || !Array.isArray(scoringResult)) return;
    const scoreByItemId = {};
    scoringResult.forEach(({ id, score }) => { scoreByItemId[String(id)] = score; });
    for (const hit of this._candidates) {
      const hitScore = scoreByItemId[String(hit._id)];
      if (hitScore != null) {
        if (!hit._scores) hit._scores = {};
        hit._scores[scoringKey] = hitScore;
      }
    }
  }
  ranking() {
    return new Ranking({
      url: this._config.rankingService,
      apiKey: this._config.apiKey,
      log: this._log,
      show: this._show,
      candidates: this._candidates,
      origin: this._origin,
    });
  }
  /** Sets hit._ranking_score from ranking items, then sorts candidates by score descending. */
  addRanking(rankingResult) {
    const rankedItems = rankingResult?.items;
    if (!this._candidates || !rankedItems || !Array.isArray(rankedItems)) return;
    const scoreByItemId = {};
    rankedItems.forEach(({ item_id, score }) => { scoreByItemId[item_id] = score; });
    for (const hit of this._candidates) {
      hit._ranking_score = scoreByItemId[hit._id];
    }
    this._candidates.sort((a, b) => (b._ranking_score ?? -Infinity) - (a._ranking_score ?? -Infinity));
  }
  getFeed() {
    return this._candidates;
  }
  /** Hydration as a first-class pipeline stage.
   *
   * Returns a Hydration builder pre-filled with the current candidates'
   * index and hits. Override via `.hits([...])` (or `.itemIds([...])` for
   * the synthetic-hit shortcut) for standalone use.
   *
   * Example:
   *   const h = await mbd.hydration()
   *     .target('user_trades', { sources: [{ plugin: 'polymarket_convergence_bets' }], limit: 15 })
   *     .execute();
   *   mbd.addHydration(h);
   */
  hydration() {
    const index = this._candidates?.[0]?._index ?? null;
    return new Hydration({
      url: this._config.searchService,
      apiKey: this._config.apiKey,
      log: this._log,
      show: this._show,
      origin: this._origin,
      index,
      hits: this._candidates || [],
    });
  }
  /** Merge a hydration result onto the current candidates.
   *
   * The server returns the same hits the SDK posted, with
   * `_source.metadata.<target>` written in place. We walk the response
   * hits by id and overwrite each matching candidate's `_source` (so the
   * mutation lands; foreign top-level fields like `_features` / `_scores`
   * on the candidate are preserved by the server). When the server
   * filtered hits via `drop_empty_hits`, the candidate list shrinks to
   * match.
   */
  addHydration(hydrationResult) {
    if (!hydrationResult || typeof hydrationResult !== 'object') return;
    const returnedHits = Array.isArray(hydrationResult.hits) ? hydrationResult.hits : null;

    if (returnedHits) {
      const byId = {};
      for (const h of returnedHits) {
        if (h && typeof h === 'object' && h._id != null) {
          byId[String(h._id)] = h;
        }
      }
      const nextCandidates = [];
      for (const hit of this._candidates || []) {
        if (!hit || typeof hit !== 'object') continue;
        const id = hit._id != null ? String(hit._id) : null;
        const updated = id ? byId[id] : null;
        if (!updated) {
          // Server dropped this hit (drop_empty_hits) — drop locally too.
          continue;
        }
        if (updated._source && typeof updated._source === 'object') {
          hit._source = updated._source;
        }
        nextCandidates.push(hit);
      }
      this._candidates = nextCandidates;
      return;
    }

    // Fallback: caller passed an item_ids-shape result (metadata dict).
    const metadata = hydrationResult.metadata;
    if (!metadata || typeof metadata !== 'object') return;
    const byId = {};
    for (const idx of Object.keys(metadata)) {
      const inner = metadata[idx] || {};
      for (const id of Object.keys(inner)) byId[String(id)] = inner[id] || {};
    }
    for (const hit of this._candidates || []) {
      if (!hit || typeof hit !== 'object') continue;
      const id = hit._id != null ? String(hit._id) : null;
      const entry = id ? byId[id] : null;
      if (!entry) continue;
      let src = hit._source;
      if (!src || typeof src !== 'object') {
        src = {};
        hit._source = src;
      }
      let meta = src.metadata;
      if (!meta || typeof meta !== 'object') {
        meta = {};
        src.metadata = meta;
      }
      for (const target of Object.keys(entry)) {
        meta[target] = entry[target];
      }
    }
  }
  /** GET /hydration/targets/{index} — named target presets for an index.
   *
   * The user-facing catalogue: each entry is `{name, family, plugin_count}`.
   * Pass any of these names to `.target(name, …)`. The server picks the
   * backing plugins; the caller never sees them.
   */
  async hydrationTargets(index) {
    if (typeof index !== 'string' || !index) throw new Error('hydrationTargets: index required');
    const url = `${this._config.searchService.replace(/\/$/, '')}/hydration/targets/${encodeURIComponent(index)}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this._config.apiKey}` } });
    if (!response.ok) throw new Error(`hydrationTargets HTTP ${response.status}`);
    const data = await response.json();
    return data?.targets || [];
  }
  /** GET /hydration/plugins — registered plugin catalogue (power-user). */
  async hydrationPlugins() {
    const url = `${this._config.searchService.replace(/\/$/, '')}/hydration/plugins`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this._config.apiKey}` } });
    if (!response.ok) throw new Error(`hydrationPlugins HTTP ${response.status}`);
    const data = await response.json();
    return data?.plugins || [];
  }
  /** GET /hydration/defaults/{index} — per-index default spec. */
  async hydrationDefaults(index) {
    if (typeof index !== 'string' || !index) throw new Error('hydrationDefaults: index required');
    const url = `${this._config.searchService.replace(/\/$/, '')}/hydration/defaults/${encodeURIComponent(index)}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this._config.apiKey}` } });
    if (!response.ok) throw new Error(`hydrationDefaults HTTP ${response.status}`);
    const data = await response.json();
    return data?.hydrate || {};
  }
  dropFeatures() {
    for (const c of this._candidates) {
      delete c._features;
    }
  }
  dropVectors() {
    const keys = ['text_vector', 'item_sem_embed', 'item_sem_embed2'];
    for (const c of this._candidates) {
      const src = c._source;
      if (src && typeof src === 'object') {
        for (const k of keys) delete src[k];
      }
    }
  }
  transform(fn) {
    this._candidates = this._candidates.map(fn);
  }
  log(string) {
    this._log(string);
  }
  show(results) {
    if (results === undefined) results = this._candidates;
    this._show(results);
  }
}
