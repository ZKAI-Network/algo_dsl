const DEX_WALLETS_INDEX = 'wallet-users';
const HYPERLIQUID_LEADERBOARD_INDEX = 'hyperliquid-leaderboard';
const HYPERLIQUID_ENRICH_INDEX = 'notification-hyperliquid-wallets';
const POLYMARKET_WALLETS_INDEX = 'notification-polymarket-wallets-v20260402';
const KALSHI_WALLETS_INDEX = 'kalshi-wallets-v20260315';

const FETCH_POOL = 1000;
const ALL_CHAINS = ['base', 'ethereum', 'solana', 'hyperliquid'];

const CHAIN_DEFAULTS = {
  all: { min_trades: 1, min_tokens: 3, min_closed: 0, min_buy_vol: 1000, max_buy_vol: 1000000000 },
  base: { min_trades: 1, min_tokens: 5, min_closed: 5, min_buy_vol: 5000, max_buy_vol: 1000000000 },
  ethereum: { min_trades: 1, min_tokens: 5, min_closed: 5, min_buy_vol: 5000, max_buy_vol: 1000000000 },
  solana: { min_trades: 1, min_tokens: 3, min_closed: 5, min_buy_vol: 1000, max_buy_vol: 1000000000 },
  polymarket: { min_trades: 3, min_tokens: 2, min_closed: 0, min_buy_vol: 1000, max_buy_vol: 1000000000 },
  hyperliquid: { min_trades: 5, min_tokens: 3, min_closed: 0, min_buy_vol: 1000, max_buy_vol: 1000000000 },
  kalshi: { min_trades: 3, min_tokens: 2, min_closed: 0, min_buy_vol: 100, max_buy_vol: 1000000000 },
};

const VALID_RANK_FIELDS = new Set([
  'total_buy_volume_usd',
  'total_sell_volume_usd',
  'net_pnl_usd',
  'trade_count',
  'win_rate',
  'true_win_rate',
  'tokens_traded',
  'avg_trade_size_usd',
  'largest_trade_usd',
  'realized_pnl_usd',
  'trader_score',
  'pnl_realized_usd',
]);

const TRADE_AGGREGATE_FIELDS = [
  'total_buy_volume_usd',
  'total_sell_volume_usd',
  'trade_count',
  'buy_count',
  'sell_count',
  'tokens_traded',
  'avg_trade_size_usd',
  'largest_trade_usd',
  'first_trade_time',
  'last_trade_time',
  'true_win_rate',
  'winning_positions',
  'closed_positions',
  'avg_holding_period_hours',
];

const DEX_SOURCE_FIELDS = [
  'wallet_address',
  'chains',
  'display_name',
  'avatar_url',
  'social_links',
  'profile_url',
  'bio',
  'x_username',
  'volume_usd_24h',
  'volume_usd_7d',
  'volume_usd_30d',
  'num_trades_24h',
  'num_trades_30d',
  'pnl_realized_usd',
  'pnl_unrealized_usd',
  'pnl_net_invested_usd',
  'pnl_pct_total',
  'pnl_total_invested_usd',
  'pnl_realized_cost_basis_usd',
  'portfolio_total_usd',
  'last_trade_timestamp',
  'zerion_last_enriched_at',
  'true_win_rate',
  'winning_positions',
  'closed_positions',
];

const mathHelpers = {
  clamp(value, min, max) {
    return Math.min(Math.max(Number(value) || 0, min), max);
  },
  log10(value) {
    return Math.log10(value);
  },
};

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = asNumber(value, 0);
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function maxAgeDays(chain) {
  return chain === 'base' || chain === 'ethereum' || chain === 'solana' ? 7 : 30;
}

function normalizeRankBy(rankBy) {
  if (rankBy === 'win_rate') return 'true_win_rate';
  if (rankBy === 'pnl_realized_usd') return 'realized_pnl_usd';
  return rankBy || 'realized_pnl_usd';
}

function primaryIndexForChain(chain) {
  if (chain === 'hyperliquid') return HYPERLIQUID_LEADERBOARD_INDEX;
  if (chain === 'polymarket') return POLYMARKET_WALLETS_INDEX;
  if (chain === 'kalshi') return KALSHI_WALLETS_INDEX;
  if (chain === 'base' || chain === 'ethereum' || chain === 'solana') return DEX_WALLETS_INDEX;
  return `${chain}-wallets`;
}

function defaultTraderScore(row) {
  const buyVol = row.total_buy_volume_usd || 0;
  const realizedPnl = row.realized_pnl_usd || 0;
  const winning = row.winning_positions || 0;
  const closed = row.closed_positions || 0;
  const trades = row.trade_count || 0;
  const pnl = Math.max(realizedPnl, 0);
  const pnlMagnitude = mathHelpers.clamp((Math.log10(Math.max(pnl, 1)) - 2) / 8.0, 0, 1);
  const efficiency = buyVol > 0 ? pnl / buyVol : 0;
  const rawEfficiency = mathHelpers.clamp(efficiency, 0, 1);
  const normEfficiency = closed < 1 ? 0 : rawEfficiency * (buyVol > 0 ? Math.min(buyVol / 5000.0, 1) : 0);
  const adjustedWr = (winning + 1) / (closed + 2);
  const consistency = Math.min(closed / 10.0, 1);
  const activity = Math.min(Math.log10(trades + 1) / 4.0, 1);
  return round(
    pnlMagnitude * 0.30 +
    adjustedWr * 0.25 +
    normEfficiency * 0.20 +
    consistency * 0.15 +
    activity * 0.10,
    4,
  );
}

function dataConfidence(row) {
  const closed = row.closed_positions || 0;
  if (closed >= 20) return 'high';
  if (closed >= 10) return 'medium';
  return 'low';
}

function filterToClause(filter) {
  if (!isPlainObject(filter)) throw new Error('Leaderboard filter must be an object');
  if (filter.filter === 'custom') return filter.value;
  if (filter.filter === 'term') return { term: { [filter.field]: filter.value } };
  if (filter.filter === 'terms') return { terms: { [filter.field]: Array.isArray(filter.value) ? filter.value : [filter.value] } };
  if (filter.filter === 'numeric') return { range: { [filter.field]: { [filter.operator || 'gte']: filter.value } } };
  if (filter.filter === 'date') {
    const body = { format: 'strict_date_optional_time||epoch_second' };
    if (filter.date_from != null) body.gte = filter.date_from;
    if (filter.date_to != null) body.lte = filter.date_to;
    return { range: { [filter.field]: body } };
  }
  if (filter.filter === 'is_null') return { bool: { must_not: [{ exists: { field: filter.field } }] } };
  if (filter.filter === 'not_null') return { exists: { field: filter.field } };
  if (filter.filter === 'match') {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    return { bool: { should: values.map((v) => ({ match: { [filter.field]: v } })), minimum_should_match: 1 } };
  }
  if (filter.filter === 'terms_lookup') {
    return { terms: { [filter.field]: { index: filter.lookup_index || filter.index, id: filter.id || filter.value, path: filter.path } } };
  }
  if (filter.filter === 'user_interaction' || filter.filter === 'console_account') {
    return { terms: { [filter.field]: { index: 'console-accounts', id: filter.value || filter.console_account_id, path: filter.path } } };
  }
  throw new Error(`Unsupported leaderboard filter: ${filter.filter}`);
}

function buildBoolQuery(filters, excludes) {
  const bool = {};
  if (filters.length > 0) bool.filter = filters;
  if (excludes.length > 0) bool.must_not = excludes;
  return Object.keys(bool).length > 0 ? { bool } : { match_all: {} };
}

function mergeMissing(row, agg) {
  if (!agg) return row;
  for (const field of TRADE_AGGREGATE_FIELDS) {
    if ((row[field] === undefined || row[field] === null || row[field] === '') && agg[field] !== undefined && agg[field] !== null) {
      row[field] = agg[field];
    }
  }
  return row;
}

function normalizeDexHit(hit, chain) {
  const source = hit._source || {};
  const rawPnl = Math.abs(source.pnl_realized_usd || 0) > 10000000 ? 0 : (source.pnl_realized_usd || 0);
  const row = {
    wallet_address: source.wallet_address || hit._id || '',
    chain,
    display_name: source.display_name || '',
    avatar_url: source.avatar_url || '',
    social_links: source.social_links || {},
    profile_url: source.profile_url || '',
    bio: source.bio || '',
    x_username: source.x_username || '',
    realized_pnl_usd: rawPnl,
    net_pnl_usd: rawPnl,
    pnl_unrealized_usd: source.pnl_unrealized_usd || 0,
    portfolio_total_usd: source.portfolio_total_usd || 0,
    total_buy_volume_usd: source.pnl_total_invested_usd ?? null,
    total_sell_volume_usd: source.pnl_realized_cost_basis_usd != null ? (source.pnl_realized_cost_basis_usd || 0) + rawPnl : null,
    trade_count: source.num_trades_30d || source.trade_count || 0,
    tokens_traded: 0,
    closed_positions: source.closed_positions || 0,
    winning_positions: source.winning_positions || 0,
    true_win_rate: source.true_win_rate || 0,
    last_trade_time: source.last_trade_timestamp || '',
    first_trade_time: '',
  };
  return row;
}

function normalizeStandardHit(hit, chain) {
  const source = hit._source || {};
  return {
    ...source,
    wallet_address: source.wallet_address || hit._id || '',
    chain: source.chain || chain,
    realized_pnl_usd: source.realized_pnl_usd ?? source.net_pnl_usd ?? 0,
    net_pnl_usd: source.net_pnl_usd ?? source.realized_pnl_usd ?? 0,
    portfolio_total_usd: source.portfolio_total_usd ?? source.account_value_usd ?? 0,
  };
}

function normalizeKalshiHit(hit) {
  const source = hit._source || {};
  const rawPnl = asNumber(source.pnl, 0);
  const volUsd = Math.max(asNumber(source.volume_quote, 0), asNumber(source.volume_outcome, 0)) / 1000000;
  return {
    wallet_address: source.user_id || hit._id || '',
    chain: 'kalshi',
    realized_pnl_usd: round(rawPnl, 2),
    net_pnl_usd: round(rawPnl, 2),
    total_buy_volume_usd: round(volUsd, 2),
    total_sell_volume_usd: 0,
    trade_count: asNumber(source.markets_traded, 0),
    tokens_traded: asNumber(source.markets_traded, 0),
    true_win_rate: 0,
    winning_positions: 0,
    closed_positions: 0,
    last_trade_time: source.last_trade_time || '',
    first_trade_time: '',
    primary_tags: source.primary_tags,
    ai_labels: source.ai_labels,
  };
}

function formatWallet(row, rank, includeIdentity) {
  const entry = {
    rank,
    wallet_address: row.wallet_address || '',
    chain: row.chain,
    trader_score: row.trader_score || 0,
    data_confidence: dataConfidence(row),
    total_buy_volume_usd: row.total_buy_volume_usd != null ? round(row.total_buy_volume_usd, 2) : null,
    total_sell_volume_usd: row.total_sell_volume_usd != null ? round(row.total_sell_volume_usd, 2) : null,
    net_pnl_usd: round(row.net_pnl_usd || 0, 2),
    realized_pnl_usd: round(row.realized_pnl_usd || 0, 2),
    unrealized_pnl_usd: round(row.pnl_unrealized_usd || 0, 2),
    portfolio_value_usd: round(row.portfolio_total_usd ?? row.account_value_usd ?? 0, 2),
    trade_count: row.trade_count || 0,
    buy_count: row.buy_count || 0,
    sell_count: row.sell_count || 0,
    true_win_rate: round(row.true_win_rate || 0, 4),
    winning_positions: row.winning_positions || 0,
    closed_positions: row.closed_positions || 0,
    tokens_traded: row.tokens_traded || 0,
    avg_trade_size_usd: round(row.avg_trade_size_usd || 0, 2),
    largest_trade_usd: round(row.largest_trade_usd || 0, 2),
    last_trade_time: row.last_trade_time || '',
    first_trade_time: row.first_trade_time || '',
  };
  if (entry.chain === 'hyperliquid' || entry.chain === 'polymarket') delete entry.unrealized_pnl_usd;
  if (entry.chain === 'polymarket') delete entry.portfolio_value_usd;
  if (includeIdentity) {
    entry.display_name = row.display_name || null;
    entry.avatar_url = row.avatar_url || '';
    entry.social_links = row.social_links || {};
  }
  return entry;
}

function buildPipelineInfo(rows) {
  const first = rows.map((r) => r.first_trade_time).filter(Boolean).sort();
  const last = rows.map((r) => r.last_trade_time).filter(Boolean).sort();
  const info = {};
  if (first.length > 0) {
    info.data_since = first[0];
    const then = new Date(String(first[0]).replace('Z', '+00:00')).getTime();
    if (!Number.isNaN(then)) info.data_age_days = Math.floor((Date.now() - then) / 86400000);
  }
  if (last.length > 0) info.latest_trade = last[last.length - 1];
  return info;
}

export class Leaderboard {
  constructor(options) {
    if (!options || typeof options !== 'object') throw new Error('Leaderboard: options object required');
    const { url, apiKey, origin = 'sdk', log, mode } = options;
    if (typeof url !== 'string' || !url.trim()) throw new Error('Leaderboard: options.url required');
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Leaderboard: options.apiKey required');
    this._url = url.trim().replace(/\/$/, '');
    this._apiKey = apiKey.trim();
    this._origin = origin;
    this._log = typeof log === 'function' ? log : console.log.bind(console);
    this._mode = mode === 'match' ? 'match' : 'normal';
    this._chain = 'base';
    this._rankBy = 'realized_pnl_usd';
    this._limit = 50;
    this._offset = 0;
    this._filters = [];
    this._excludeFilters = [];
    this._selectFields = [];
    this._includeIdentity = false;
    this._hideBots = false;
    this._traderScoreFn = defaultTraderScore;
    this._useCustomTraderScore = false;
    this._overrides = {};
  }

  chain(value) { this._chain = value || 'base'; return this; }
  rankBy(value) { this._rankBy = normalizeRankBy(value); return this; }
  sortByTraderScore() { this._rankBy = 'trader_score'; return this; }
  limit(value) { this._limit = Math.max(1, Math.min(Number(value) || 50, 200)); return this; }
  offset(value) { this._offset = Math.max(0, Number(value) || 0); return this; }
  minTrades(value) { this._overrides.min_trades = Number(value); return this; }
  minTokens(value) { this._overrides.min_tokens = Number(value); return this; }
  minClosed(value) { this._overrides.min_closed = Number(value); return this; }
  minBuyVol(value) { this._overrides.min_buy_vol = Number(value); return this; }
  maxBuyVol(value) { this._overrides.max_buy_vol = Number(value); return this; }
  hideBots(value = true) { this._hideBots = Boolean(value); return this; }
  includeIdentity(value = true) { this._includeIdentity = Boolean(value); return this; }
  where(filter) { this._filters.push(filterToClause(filter)); return this; }
  whereEs(clause) { this._filters.push(clause); return this; }
  exclude(filter) { this._excludeFilters.push(filterToClause(filter)); return this; }
  excludeEs(clause) { this._excludeFilters.push(clause); return this; }
  selectFields(fields) {
    if (Array.isArray(fields)) this._selectFields = fields.filter((f) => typeof f === 'string' && f);
    return this;
  }
  traderScore(fn) {
    if (typeof fn !== 'function') throw new Error('Leaderboard.traderScore: fn must be a function');
    this._traderScoreFn = (row) => round(fn({ row, math: mathHelpers }), 4);
    this._useCustomTraderScore = true;
    this._rankBy = 'trader_score';
    return this;
  }

  async _post(endpoint, body) {
    const response = await fetch(`${this._url}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this._apiKey}` },
      body: JSON.stringify({ origin: this._origin, ...body }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${endpoint} HTTP ${response.status}: ${text}`);
    }
    const data = await response.json();
    if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    if (data?.result?.error) throw new Error(typeof data.result.error === 'string' ? data.result.error : JSON.stringify(data.result.error));
    return data.result ?? data;
  }

  async schemaFields(index) {
    const response = await fetch(`${this._url}/schema/fields?index=${encodeURIComponent(index)}`, {
      headers: { Authorization: `Bearer ${this._apiKey}` },
    });
    if (!response.ok) throw new Error(`/schema/fields HTTP ${response.status}`);
    const data = await response.json();
    if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    return data.result ?? data;
  }

  _defaults(chain = this._chain) {
    return { ...CHAIN_DEFAULTS[chain], ...this._overrides };
  }

  _primarySortField(chain, rankBy) {
    if (rankBy === 'trader_score') return chain === 'hyperliquid' ? 'net_pnl_usd' : 'realized_pnl_usd';
    if (chain === 'base' || chain === 'ethereum' || chain === 'solana') {
      if (rankBy === 'realized_pnl_usd' || rankBy === 'net_pnl_usd') return 'pnl_realized_usd';
      if (rankBy === 'trade_count') return 'num_trades_30d';
      if (rankBy === 'true_win_rate') return 'pnl_pct_total';
    }
    if (chain === 'kalshi') return rankBy === 'trade_count' ? 'markets_traded' : 'pnl';
    if (chain === 'hyperliquid') return rankBy === 'realized_pnl_usd' ? 'net_pnl_usd' : rankBy;
    return rankBy;
  }

  _dexQuery(chain, size, from, sortField, defaults) {
    const source = [...new Set([...DEX_SOURCE_FIELDS, ...this._selectFields])];
    const filters = [
      { term: { chains: chain } },
      { range: { num_trades_30d: { gte: defaults.min_trades } } },
      { range: { volume_usd_30d: { gte: defaults.min_buy_vol, lte: defaults.max_buy_vol } } },
      { range: { pnl_realized_usd: { gt: -10000000, lt: 10000000 } } },
      { range: { last_trade_timestamp: { gte: `now-${maxAgeDays(chain)}d` } } },
      { range: { zerion_last_enriched_at: { gte: 'now-7d' } } },
      ...this._filters,
    ];
    const mustNot = [
      ...(this._hideBots ? [{ term: { pnl_realized_usd: 0 } }] : []),
      ...this._excludeFilters,
    ];
    return {
      size,
      from,
      sort: [{ [sortField]: { order: 'desc', unmapped_type: 'float' } }],
      query: buildBoolQuery(filters, mustNot),
      _source: source,
    };
  }

  _standardQuery(chain, size, from, sortField, defaults) {
    const filters = [...this._filters];
    if (chain === 'kalshi') {
      filters.push({ range: { markets_traded: { gte: defaults.min_trades } } });
      filters.push({ range: { pnl: { gt: -1000000, lt: 1000000 } } });
    }
    if (this._hideBots) filters.push({ bool: { must_not: [{ term: { net_pnl_usd: 0 } }] } });
    return {
      size,
      from,
      sort: [{ [sortField]: { order: 'desc', unmapped_type: 'float' } }],
      query: buildBoolQuery(filters, this._excludeFilters),
    };
  }

  async _search(index, query) {
    const result = await this._post('/search/es_query', { index, feed_type: 'es_query', query });
    return result?.hits || result?.result?.hits || [];
  }

  async _multiSearch(searches) {
    const result = await this._post('/search/multi', { searches });
    return result?.responses || result?.result?.responses || [];
  }

  async _mget(index, ids, sourceIncludes = TRADE_AGGREGATE_FIELDS) {
    if (!ids.length) return {};
    const result = await this._post('/search/mget', { index, ids, source_includes: sourceIncludes });
    return result?.by_id || result?.result?.by_id || {};
  }

  async _enrichRows(rows, index) {
    const ids = rows.map((r) => r.wallet_address).filter(Boolean);
    const byId = await this._mget(index, ids);
    for (const row of rows) mergeMissing(row, byId[row.wallet_address]?._source);
    return rows;
  }

  async _queryChain(chain, size, from, rankBy) {
    const defaults = this._defaults(chain);
    const sortField = this._primarySortField(chain, rankBy);
    const index = primaryIndexForChain(chain);
    if (chain === 'base' || chain === 'ethereum' || chain === 'solana') {
      const hits = await this._search(index, this._dexQuery(chain, size, from, sortField, defaults));
      let rows = hits.map((hit) => normalizeDexHit(hit, chain));
      await this._enrichRows(rows, `${chain}-wallets`);
      if (rows.length === 0) {
        const fallbackQuery = {
          size,
          from,
          sort: [{ [rankBy === 'trader_score' ? 'realized_pnl_usd' : rankBy]: { order: 'desc', unmapped_type: 'float' } }],
          query: {
            bool: {
              filter: [
                { range: { trade_count: { gte: defaults.min_trades } } },
                { range: { tokens_traded: { gte: defaults.min_tokens } } },
                { range: { closed_positions: { gte: defaults.min_closed } } },
                { range: { total_buy_volume_usd: { gte: defaults.min_buy_vol, lte: defaults.max_buy_vol } } },
                { range: { last_trade_time: { gte: `now-${maxAgeDays(chain)}d` } } },
                ...this._filters,
              ],
              must_not: [...(this._hideBots ? [{ term: { net_pnl_usd: 0 } }] : []), ...this._excludeFilters],
            },
          },
        };
        const fallbackHits = await this._search(`${chain}-wallets`, fallbackQuery);
        rows = fallbackHits.map((hit) => normalizeStandardHit(hit, chain));
      }
      return rows;
    }
    if (chain === 'hyperliquid') {
      const hits = await this._search(index, this._standardQuery(chain, size, from, sortField, defaults));
      const rows = hits.map((hit) => normalizeStandardHit(hit, chain));
      await this._enrichRows(rows, HYPERLIQUID_ENRICH_INDEX);
      return rows;
    }
    if (chain === 'kalshi') {
      const hits = await this._search(index, this._standardQuery(chain, size, from, sortField, defaults));
      return hits.map((hit) => normalizeKalshiHit(hit));
    }
    const hits = await this._search(index, this._standardQuery(chain, size, from, sortField, defaults));
    return hits.map((hit) => normalizeStandardHit(hit, chain));
  }

  _scoreRows(rows) {
    for (const row of rows) row.trader_score = this._traderScoreFn(row);
    return rows;
  }

  _formatPayload(rows, chain, rankBy, totalRows = null) {
    const pageRows = rows.slice(0, this._limit);
    const wallets = pageRows.map((row, i) => formatWallet(row, this._offset + i + 1, this._includeIdentity));
    return {
      wallets,
      total: totalRows ?? wallets.length,
      rank_by: rankBy,
      chain,
      chain_defaults: this._defaults(chain),
      pipeline_info: buildPipelineInfo(pageRows),
      updated_at: new Date().toISOString(),
    };
  }

  async _executeAll(rankBy) {
    const searches = ALL_CHAINS.map((chain) => {
      const defaults = this._defaults(chain);
      const sortField = this._primarySortField(chain, 'realized_pnl_usd');
      const index = primaryIndexForChain(chain);
      const query = chain === 'base' || chain === 'ethereum' || chain === 'solana'
        ? this._dexQuery(chain, FETCH_POOL, 0, sortField, defaults)
        : this._standardQuery(chain, FETCH_POOL, 0, sortField, defaults);
      return { chain, index, query };
    });

    const responses = await this._multiSearch(searches.map(({ index, query }) => ({ index, query })));
    const rows = [];
    const dexFallbacks = [];

    responses.forEach((response, i) => {
      const chain = searches[i].chain;
      const hits = response?.result?.hits || response?.hits || [];
      let chainRows = [];
      if (chain === 'base' || chain === 'ethereum' || chain === 'solana') {
        chainRows = hits.map((hit) => normalizeDexHit(hit, chain));
        if (chainRows.length === 0) dexFallbacks.push(chain);
      } else {
        chainRows = hits.map((hit) => normalizeStandardHit(hit, chain));
      }
      rows.push(...chainRows);
    });

    await Promise.all([
      ...ALL_CHAINS
        .filter((chain) => chain === 'base' || chain === 'ethereum' || chain === 'solana')
        .map((chain) => this._enrichRows(rows.filter((row) => row.chain === chain), `${chain}-wallets`)),
      this._enrichRows(rows.filter((row) => row.chain === 'hyperliquid'), HYPERLIQUID_ENRICH_INDEX),
    ]);

    const fallbackRows = await Promise.all(
      dexFallbacks.map((chain) => this._queryChain(chain, FETCH_POOL, 0, 'realized_pnl_usd')),
    );
    for (const chainRows of fallbackRows) rows.push(...chainRows);

    this._scoreRows(rows);
    const seen = new Map();
    for (const row of rows) {
      const addr = row.wallet_address || '';
      const prev = seen.get(addr);
      if (!prev || (row.trader_score || 0) > (prev.trader_score || 0)) seen.set(addr, row);
    }
    const merged = [...seen.values()];
    merged.sort((a, b) => rankBy === 'trader_score'
      ? (b.trader_score || 0) - (a.trader_score || 0)
      : (b.realized_pnl_usd || 0) - (a.realized_pnl_usd || 0));
    const page = merged.slice(this._offset, this._offset + this._limit);
    return this._formatPayload(page, 'all', rankBy, page.length);
  }

  async execute() {
    if (this._mode === 'match') return { wallets: [], total: 0, rank_by: this._rankBy, chain: this._chain };
    if (!CHAIN_DEFAULTS[this._chain]) throw new Error(`Unsupported leaderboard chain: ${this._chain}`);
    const rankBy = normalizeRankBy(this._rankBy);
    if (!VALID_RANK_FIELDS.has(rankBy)) throw new Error(`Unsupported leaderboard rank field: ${rankBy}`);
    if (this._chain === 'all') return this._executeAll(rankBy);

    const useComposite = rankBy === 'trader_score';
    const size = useComposite ? FETCH_POOL : this._limit;
    const from = useComposite ? 0 : this._offset;
    let rows = await this._queryChain(this._chain, size, from, rankBy);
    this._scoreRows(rows);
    if (useComposite) {
      if (this._hideBots) rows = rows.filter((row) => (row.net_pnl_usd || 0) !== 0);
      rows.sort((a, b) => (b.trader_score || 0) - (a.trader_score || 0));
      rows = rows.slice(this._offset, this._offset + this._limit);
    }
    return this._formatPayload(rows, this._chain, rankBy, useComposite ? rows.length : null);
  }
}
