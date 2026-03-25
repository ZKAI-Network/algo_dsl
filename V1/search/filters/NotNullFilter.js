import { Filter } from './Filter.js';
export class NotNullFilter extends Filter {
  constructor(field, boost = null) {
    super('not_null', field, boost);
  }
}
