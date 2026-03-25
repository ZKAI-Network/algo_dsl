import { Filter } from './Filter.js';

/** Boosts items by group membership. lookup_index/field/value identify the group; min_boost/max_boost/n control boost range. */
export class GroupBoostFilter extends Filter {
  constructor(lookup_index, field, value, group, min_boost = null, max_boost = null, n = null) {
    super('group_boost', field, null);
    this.lookup_index = lookup_index;
    this.value = value;
    this.group = group;
    this.min_boost = min_boost;
    this.max_boost = max_boost;
    this.n = n;
  }
}
