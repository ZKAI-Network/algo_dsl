import { Filter } from './Filter.js';

/** Filters by the customer's in_app_users audience (wallets pushed via the
 * data sources users API). Resolves at query time to a terms_lookup against
 * console-accounts/_doc/<customer_id>.in_app_users — same mechanic as
 * ConsoleAccountFilter, with index + path fixed downstream. */
export class InAppUsersFilter extends Filter {
  constructor(field, customer_id, boost = null) {
    super('in_app_users', field, boost);
    this.value = customer_id;
  }
}
