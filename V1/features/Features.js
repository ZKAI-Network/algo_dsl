/** Feature columns shown first when listing available features (relevance, affinity, clusters, semantic). */
export const PREFERRED_FEATURE_COLUMNS = [
  'found', 'original_rank', 'sem_sim_fuzzy', 'sem_sim_closest',
  'usr_primary_labels', 'usr_secondary_labels', 'usr_primary_tags', 'usr_secondary_tags',
  'user_affinity_avg', 'user_affinity_usdc', 'user_affinity_count',
  'cluster_1', 'cluster_2', 'cluster_3', 'cluster_4', 'cluster_5',
  'cluster_6', 'cluster_7', 'cluster_8', 'cluster_9', 'cluster_10',
  'sem_sim_cluster1', 'sem_sim_cluster2', 'sem_sim_cluster3', 'sem_sim_cluster4', 'sem_sim_cluster5',
];
export function sortAvailableFeatures(available) {
  const preferred = PREFERRED_FEATURE_COLUMNS.filter((col) => available.includes(col));
  const nonPreferred = available.filter((col) => !PREFERRED_FEATURE_COLUMNS.includes(col));
  const regular = nonPreferred.filter((col) => !col.startsWith('AI:') && !col.startsWith('TAG:')).sort();
  const aiColumns = nonPreferred.filter((col) => col.startsWith('AI:')).sort();
  const tagColumns = nonPreferred.filter((col) => col.startsWith('TAG:')).sort();
  return [...preferred, ...regular, ...aiColumns, ...tagColumns];
}
export class Features {
  _version = 'v1';
  _user = null;
  _items = [];
  lastCall = null;
  lastResult = null;
  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('Features: options object is required');
    }
    const { url, apiKey, version = 'v1', items = [], userIndex, userId, origin = 'sdk', log, show } = options;
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Features: options.url is required and must be a non-empty string');
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Features: options.apiKey is required and must be a non-empty string');
    }
    this._url = url.trim().replace(/\/$/, '');
    this._apiKey = apiKey.trim();
    this._version = version;
    this._origin = typeof origin === 'string' && origin.trim() ? origin.trim() : 'sdk';
    this._log = typeof log === 'function' ? log : console.log.bind(console);
    this._show = typeof show === 'function' ? show : console.log.bind(console);
    if (Array.isArray(items) && items.length > 0) this._items = items;
    if (userIndex != null && userId != null) this._user = { index: userIndex, id: userId };
  }
  getEndpoint() {
    return `/features/${this._version}`;
  }
  getPayload() {
    return { origin: this._origin, user: this._user, items: this._items.map((item) => ({ ...item })) };
  }
  version(v) {
    this._version = v;
    return this;
  }
  items(items) {
    this._items = [...items];
    return this;
  }
  user(index, userId) {
    this._user = { index, id: userId };
    return this;
  }
  async execute() {
    if (!this._user || !this._user.index || !this._user.id) {
      throw new Error('Features.execute: user must be set (call user(index, userId) first)');
    }
    if (!Array.isArray(this._items) || this._items.length === 0) {
      throw new Error('Features.execute: items must be set and non-empty (call items([...]) first)');
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
      let message = `Features API error: ${response.status} ${response.statusText}`;
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
    if (!res) throw new Error('Features.execute: result.result is undefined');
    const infos = {
      took_sdk_ms: result.took_sdk,
      took_backend_ms: res.took_backend ?? 0,
      took_dynamo_user_ms: res.took_dynamo_user ?? 0,
      took_dynamo_items_ms: res.took_dynamo_items ?? 0,
      took_dynamo_interactions_ms: res.took_dynamo_interactions ?? 0,
      took_features_ms: res.took_features ?? 0,
      took_semantic_ms: res.took_semantic ?? 0,
      took_topics_ms: res.took_topics ?? 0,
      took_topic_similarity_ms: res.took_topic_similarity ?? 0,
      took_user_affinity_ms: res.took_user_affinity ?? 0,
      took_clustering_ms: res.took_clustering ?? 0,
      hit_rate_pct: ((res.hit_rate ?? 0) * 100).toFixed(1),
      item_embed_rate_pct: ((res.item_embed_rate ?? 0) * 100).toFixed(1),
    };
    this._log('Features result:');
    this._log(`  took_sdk_ms: ${infos.took_sdk_ms}`);
    this._log(`  took_backend_ms: ${infos.took_backend_ms}`);
    this._log(`  took_dynamo_user_ms: ${infos.took_dynamo_user_ms}`);
    this._log(`  took_dynamo_items_ms: ${infos.took_dynamo_items_ms}`);
    this._log(`  took_dynamo_interactions_ms: ${infos.took_dynamo_interactions_ms}`);
    this._log(`  took_features_ms: ${infos.took_features_ms}`);
    this._log(`  took_semantic_ms: ${infos.took_semantic_ms}`);
    this._log(`  took_topics_ms: ${infos.took_topics_ms}`);
    this._log(`  took_topic_similarity_ms: ${infos.took_topic_similarity_ms}`);
    this._log(`  took_user_affinity_ms: ${infos.took_user_affinity_ms}`);
    this._log(`  took_clustering_ms: ${infos.took_clustering_ms}`);
    this._log(`  hit_rate: ${infos.hit_rate_pct}%`);
    this._log(`  item_embed_rate: ${infos.item_embed_rate_pct}%`);
    return res;
  }
  log(string) {
    this._log(string);
  }
  show(results) {
    this._show(results);
  }
}
