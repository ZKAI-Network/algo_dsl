/**
 * Ensures the value is an array. Backend expects array for terms/match filters.
 * - Arrays are returned as-is
 * - Strings are converted: comma-separated strings are split; single values wrapped in array
 */
export function normalizeToArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.includes(',')
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : [value];
  }
  return value != null ? [value] : [];
}

export class Filter {
  constructor(filterType, field, boost = null) {
    if (new.target === Filter) throw new Error('Filter is abstract and cannot be instantiated directly');
    this.filter = filterType;
    this.field = field;
    this.boost = boost;
  }
}
