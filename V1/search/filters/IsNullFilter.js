import { Filter } from './Filter.js';
export class IsNullFilter extends Filter {
  constructor(field, boost = null) {
    super('is_null', field, boost);
  }
}
