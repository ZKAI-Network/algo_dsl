import { Filter } from './Filter.js';

/** Filters by the calling customer's in_app_users audience — wallets pushed
 *  via the data sources users API. The customer is identified server-side
 *  from the request's auth (x-account header injected by ds_proxy), so the
 *  caller doesn't pass an account id. Resolves at query time to a
 *  terms_lookup against console-accounts/_doc/<customer_id>.in_app_users. */
export class InAppUsersFilter extends Filter {
  constructor(field, boost = null) {
    super('in_app_users', field, boost);
  }
}
