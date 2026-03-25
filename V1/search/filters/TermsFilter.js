import { Filter, normalizeToArray } from './Filter.js';
export class TermsFilter extends Filter {
  constructor(field, value, boost = null) {
    super('terms', field, boost);
    this.value = normalizeToArray(value);
  }
}
