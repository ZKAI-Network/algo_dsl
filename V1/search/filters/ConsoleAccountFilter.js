import { Filter } from './Filter.js';

/** Filters by console account data. path: dot-notation field in the account doc. */
export class ConsoleAccountFilter extends Filter {
  constructor(field, value, path, boost = null) {
    super('console_account', field, boost);
    this.value = value;
    this.path = path;
  }
}
