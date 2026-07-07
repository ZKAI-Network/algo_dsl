import { Filter } from './Filter.js';

/** Filters candidates by membership in a user-interactions-derived list on the
 *  viewer's console-accounts doc (e.g. `following`, `muted`, `blocked`).
 *  Populated by the data-source rollup driven by the datasource's rollup_config
 *  (see embed-iac datasource-es-writer).
 *
 *  listName: the array field on the console-accounts doc that holds the ids to
 *  match `field` against (e.g. `following`). Serialized as `path` on the wire
 *  for backend compatibility. */
export class UserInteractionFilter extends Filter {
  constructor(field, value, listName, boost = null) {
    super('user_interaction', field, boost);
    this.value = value;
    this.path = listName;
  }
}
