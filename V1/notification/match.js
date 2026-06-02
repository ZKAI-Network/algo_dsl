/**
 * matchFilters — synchronous predicate over a single document.
 *
 * The push worker (ds_algo_runner) and Search.match(candidate) both use this
 * to test whether a candidate doc passes an algo's include[] / exclude[]
 * filters without making any HTTP calls. boost[] filters are ignored (they
 * are scoring signals, not gates).
 *
 * Returns true when the candidate passes every include filter AND no exclude
 * filter matches.
 */

/** Read a possibly-dotted field path from a plain object. */
function readField(doc, field) {
  if (!field || !doc) return undefined;
  if (Object.prototype.hasOwnProperty.call(doc, field)) return doc[field];
  if (!field.includes('.')) return undefined;
  let cur = doc;
  for (const part of field.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function compareNumeric(actual, op, target) {
  const a = Number(actual);
  const t = Number(target);
  if (Number.isNaN(a) || Number.isNaN(t)) return false;
  switch (op) {
    case '>':  return a > t;
    case '>=': return a >= t;
    case '<':  return a < t;
    case '<=': return a <= t;
    case '=':
    case '==': return a === t;
    case '!=': return a !== t;
    default:   return false;
  }
}

/**
 * Evaluate a single filter spec object against a doc.
 * Filter spec shape (from V1/search/filters/*):
 *   { filter: 'term'|'terms'|'numeric'|'date'|'is_null'|'not_null'|'match'|..., field, value?, operator? }
 */
function evaluateFilter(doc, f) {
  if (!f || typeof f !== 'object') return false;
  const v = readField(doc, f.field);
  switch (f.filter) {
    case 'term':
      return v === f.value || String(v) === String(f.value);
    case 'terms': {
      const list = Array.isArray(f.value) ? f.value : [];
      if (Array.isArray(v)) return v.some((x) => list.includes(x) || list.map(String).includes(String(x)));
      return list.includes(v) || list.map(String).includes(String(v));
    }
    case 'numeric':
      return compareNumeric(v, f.operator, f.value);
    case 'date': {
      if (v == null) return false;
      const t = Date.parse(typeof v === 'string' ? v : String(v));
      if (Number.isNaN(t)) return false;
      const from = f.value?.date_from ? Date.parse(f.value.date_from) : null;
      const to = f.value?.date_to ? Date.parse(f.value.date_to) : null;
      if (from != null && t < from) return false;
      if (to != null && t > to) return false;
      return true;
    }
    case 'is_null':
      return v == null;
    case 'not_null':
      return v != null;
    case 'match': {
      // Coarse: substring on stringified value (ES match is tokenized; we
      // approximate without tokenization for push-time filtering).
      if (v == null) return false;
      const hay = String(v).toLowerCase();
      const needle = String(f.value).toLowerCase();
      return hay.includes(needle);
    }
    default:
      // Conservative: unknown filter types fail-closed in match mode (the
      // worker can't evaluate them; the algo is not eligible for push).
      return false;
  }
}

/**
 * Run all include[] (AND) and exclude[] (NOT) filters against the doc.
 * boost[] is ignored — it's a ranking signal, not a gate.
 *
 * @param {object} doc — the candidate doc (e.g. a notification-candidates Pub/Sub message)
 * @param {{ include?: object[], exclude?: object[] }} filters
 * @returns {boolean}
 */
export function matchFilters(doc, { include = [], exclude = [] } = {}) {
  for (const f of include) {
    if (!evaluateFilter(doc, f)) return false;
  }
  for (const f of exclude) {
    if (evaluateFilter(doc, f)) return false;
  }
  return true;
}
