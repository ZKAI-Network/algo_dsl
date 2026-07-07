import { UserInteractionFilter } from './UserInteractionFilter.js';

let _warned = false;

/** @deprecated Use {@link UserInteractionFilter} (search.userInteraction(...)) instead.
 *  Subclass emits the same `filter: 'user_interaction'` token as UserInteractionFilter,
 *  so migration is transparent server-side. */
export class ConsoleAccountFilter extends UserInteractionFilter {
  constructor(field, value, path, boost = null) {
    super(field, value, path, boost);
    if (!_warned) {
      _warned = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[algo_dsl] search.consoleAccount(...) / ConsoleAccountFilter is deprecated; ' +
        'use search.userInteraction(...) / UserInteractionFilter.',
      );
    }
  }
}
