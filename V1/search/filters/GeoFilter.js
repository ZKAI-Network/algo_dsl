import { Filter } from './Filter.js';
export class GeoFilter extends Filter {
  constructor(field, value, boost = null) {
    super('geo', field, boost);
    this.value = value;
  }
}
