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
