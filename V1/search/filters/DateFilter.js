import { Filter } from './Filter.js';
export class DateFilter extends Filter {
  constructor(field, dateFrom = null, dateTo = null, boost = null) {
    super('date', field, boost);
    if (dateFrom == null && dateTo == null) throw new Error('DateFilter: at least one of dateFrom or dateTo must be provided');
    const value = {};
    if (dateFrom != null) value.date_from = dateFrom;
    if (dateTo != null) value.date_to = dateTo;
    this.value = value;
  }
}
