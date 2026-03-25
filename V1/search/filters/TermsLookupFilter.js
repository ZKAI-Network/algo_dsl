import { Filter } from './Filter.js';

/** Filters by terms fetched from another index. path: dot-notation field in lookup doc (e.g. "followers.ids"). */
export class TermsLookupFilter extends Filter {
  constructor(lookup_index, field, value, path, boost = null) {
    super('terms_lookup', field, boost);
    this.lookup_index = lookup_index;
    this.value = value;
    this.path = path;
  }
}
