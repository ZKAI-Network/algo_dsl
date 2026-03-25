/**
 * MBD Studio SDK – search, features, scoring, and ranking for personalized feeds.
 * @example
 * const config = new StudioConfig({ apiKey, commonUrl });
 * const studio = new StudioV1({ config });
 * const hits = await studio.search().index('farcaster-items').include().term('type', 'cast').execute();
 */

// --- StudioConfig ---

export interface StudioConfigOptions {
  apiKey: string;
  commonUrl?: string;
  servicesUrl?: {
    searchService: string;
    storiesService: string;
    featuresService: string;
    scoringService: string;
    rankingService: string;
  };
  log?: (msg: string) => void;
  show?: (results?: unknown) => void;
}

export class StudioConfig {
  constructor(options: StudioConfigOptions);
}

// --- Filter (abstract base, used by Search.filter()) ---

export class Filter {
  constructor(filterType: string, field: string, boost?: number | null);
}

// --- Search ---

export interface SearchHit {
  _index?: string;
  _id?: string;
  _source?: Record<string, unknown>;
  _features?: Record<string, number>;
  _scores?: Record<string, number>;
  _info?: Record<string, unknown>;
  _ranking_score?: number;
}

export interface SearchResult {
  total_hits?: number;
  hits?: SearchHit[];
  took_es?: number;
  took_backend?: number;
  max_score?: number;
}

export interface FrequentValueItem {
  id: string | number;
  count: number;
}

export type FrequentValuesResult = FrequentValueItem[];

export class Search {
  lastCall: { endpoint: string; payload: unknown } | null;
  lastResult: unknown;

  index(selected_index: string): this;
  size(size: number): this;
  onlyIds(value?: boolean): this;
  includeVectors(value?: boolean): this;
  selectFields(fields: string[] | null): this;
  text(text: string): this;
  vector(vector: number[]): this;
  esQuery(rawQuery: Record<string, unknown>): this;
  sortBy(field: string, direction?: 'asc' | 'desc', field2?: string, direction2?: 'asc' | 'desc'): this;
  include(): this;
  exclude(): this;
  boost(): this;
  filter(filterInstance: Filter): this;
  term(field: string, value: string | number | boolean, boost?: number | null): this;
  terms(field: string, values: (string | number | boolean)[], boost?: number | null): this;
  numeric(field: string, operator: string, value: number, boost?: number | null): this;
  date(field: string, dateFrom?: string | null, dateTo?: string | null, boost?: number | null): this;
  geo(field: string, value: unknown, boost?: number | null): this;
  match(field: string, value: string, boost?: number | null): this;
  isNull(field: string, boost?: number | null): this;
  notNull(field: string, boost?: number | null): this;
  custom(field: string, value: unknown, boost?: number | null): this;
  groupBoost(
    lookup_index: string,
    field: string,
    value: unknown,
    group: string,
    min_boost?: number | null,
    max_boost?: number | null,
    n?: number | null
  ): this;
  termsLookup(
    lookup_index: string,
    field: string,
    value: unknown,
    path: string,
    boost?: number | null
  ): this;
  consoleAccount(field: string, value: unknown, path: string, boost?: number | null): this;
  execute(): Promise<SearchHit[]>;
  frequentValues(field: string, size?: number): Promise<FrequentValuesResult>;
  lookup(docId: string): Promise<unknown>;
  log(string: string): void;
  show(results?: unknown): void;
}

// --- Features ---

export interface FeaturesResult {
  features?: Record<string, Record<string, Record<string, number>>>;
  scores?: Record<string, Record<string, Record<string, number>>>;
  info?: Record<string, Record<string, Record<string, unknown>>>;
  took_backend?: number;
  hit_rate?: number;
  item_embed_rate?: number;
  [key: string]: unknown;
}

export class Features {
  lastCall: { endpoint: string; payload: unknown } | null;
  lastResult: unknown;

  version(v: string): this;
  items(items: Array<{ index: string; id: string }>): this;
  user(index: string, userId: string): this;
  execute(): Promise<FeaturesResult>;
  log(string: string): void;
  show(results?: unknown): void;
}

// --- Scoring ---

export class Scoring {
  lastCall: { endpoint: string; payload: unknown } | null;
  lastResult: unknown;

  model(endpoint: string): this;
  userId(userId: string): this;
  itemIds(itemIds: string[]): this;
  execute(): Promise<string[]>;
  log(string: string): void;
  show(results?: unknown): void;
}

// --- Ranking ---

export interface RankingItem {
  item_id: string;
  score: number;
}

export interface RankingResult {
  items: RankingItem[];
  [key: string]: unknown;
}

export class Ranking {
  lastCall: { endpoint: string; payload: unknown } | null;
  lastResult: unknown;

  sortingMethod(x: 'sort' | 'linear' | 'mix'): this;
  sortBy(
    field: string,
    direction?: 'asc' | 'desc',
    field2?: string,
    direction2?: 'asc' | 'desc'
  ): this;
  weight(field: string, w: number): this;
  mix(field: string, direction: 'asc' | 'desc', percentage: number): this;
  diversity(method: 'fields' | 'semantic'): this;
  fields(arrayOrItem: string | string[]): this;
  horizon(n: number): this;
  lambda(value: number): this;
  limitByField(): this;
  every(n: number): this;
  limit(field: string, max: number): this;
  candidates(candidates: SearchHit[]): this;
  execute(): Promise<RankingResult>;
  log(string: string): void;
  show(results?: unknown): void;
}

// --- Studio (main client) ---

export interface StudioOptions {
  config?: StudioConfig;
  apiKey?: string;
  commonUrl?: string;
  servicesUrl?: StudioConfigOptions['servicesUrl'];
  log?: (msg: string) => void;
  show?: (results?: unknown) => void;
  origin?: string;
}

export class Studio {
  constructor(options: StudioOptions);

  version(): string;
  forUser(index: string, userId: string): void;
  search(): Search;
  frequentValues(index: string, field: string, size?: number): Promise<FrequentValuesResult>;
  addCandidates(array: SearchHit[]): void;
  features(version?: string): Features;
  addFeatures(featuresResult: FeaturesResult): void;
  scoring(): Scoring;
  addScores(scoringResult: Array<{ id: string; score: number }>, scoringKey: string): void;
  ranking(): Ranking;
  addRanking(rankingResult: { items?: RankingItem[] }): void;
  log(string: string): void;
  show(results?: SearchHit[]): void;
  getFeed(): SearchHit[];
}

// --- Main export ---

export const StudioV1: typeof Studio;
