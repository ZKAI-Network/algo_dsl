import { Filter } from './Filter.js';
export class TermFilter extends Filter {
  constructor(field, value, boost = null) {
    super('term', field, boost);
    this.value = value;
  }
}
