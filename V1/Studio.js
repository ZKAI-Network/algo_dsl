import { StudioConfig } from '../StudioConfig.js';
import { Search } from './search/Search.js';
import { Features, sortAvailableFeatures } from './features/Features.js';
import { Scoring } from './scoring/Scoring.js';
import { Ranking } from './ranking/Ranking.js';
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
  /**
   * Hydrate one or more targets on a caller-supplied list of hits via the
   * server's /hydration/run endpoint. Mutates `hits` in place and returns
   * the same array for chaining.
   *
   * Example:
   *   await mbd.hydrate(hits, {
   *     '_source.user_trades': { limit: 15, sources: [
   *       { plugin: 'polymarket_interesting_bets', share: 0.5 },
   *       { plugin: 'polymarket_convergence_bets', share: 0.5 },
   *     ] },
   *   });
   */
  async hydrate(hits, spec) {
    if (!Array.isArray(hits) || hits.length === 0) return hits;
    if (!spec || typeof spec !== 'object') {
      throw new Error('Studio.hydrate: spec object is required');
    }
    const index = hits[0]?._index;
    if (typeof index !== 'string' || !index) {
      throw new Error('Studio.hydrate: hits[0]._index must be a non-empty string');
    }
    const url = `${this._config.searchService.replace(/\/$/, '')}/hydration/run`;
    const body = JSON.stringify({ index, hits, hydrate: spec });
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this._config.apiKey}` },
        body,
      });
    } catch (err) {
      this._log(`Studio.hydrate fetch failed: ${err && err.message ? err.message : err}`);
      return hits;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this._log(`Studio.hydrate HTTP ${response.status}: ${text.slice(0, 200)}`);
      return hits;
    }
    const data = await response.json().catch(() => null);
    if (!data || !Array.isArray(data.hits)) return hits;
    // Server returns the same hits with merged _source — overwrite in place.
    for (let i = 0; i < hits.length; i++) {
      const updated = data.hits[i];
      if (updated && updated._source && typeof updated._source === 'object') {
        Object.assign(hits[i]._source || (hits[i]._source = {}), updated._source);
      }
    }
    const ms = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
    this._log(`hydrate: ${hits.length} hits, targets=${Object.keys(spec).join(',')}, ${ms}ms`);
    return hits;
  }
  /** GET /hydration/plugins — registered plugin catalogue. */
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
