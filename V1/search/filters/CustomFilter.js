import { Filter } from './Filter.js';
export class CustomFilter extends Filter {
  constructor(field, value, boost = null) {
    super('custom', field, boost);
    this.value = value;
  }
}
