import { Filter, normalizeToArray } from './Filter.js';
export class MatchFilter extends Filter {
  constructor(field, value, boost = null) {
    super('match', field, boost);
    this.value = normalizeToArray(value);
  }
}
