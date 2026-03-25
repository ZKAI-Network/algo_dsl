import { Filter } from './Filter.js';
export class NumericFilter extends Filter {
  constructor(field, operator, value, boost = null) {
    super('numeric', field, boost);
    this.operator = operator;
    this.value = value;
  }
}
