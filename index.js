/**
 * MBD Studio SDK – search, features, scoring, and ranking for personalized feeds.
 * @example
 * const config = new StudioConfig({ apiKey, commonUrl });
 * const studio = new StudioV1({ config });
 * const hits = await studio.search().index('farcaster-items').include().term('type', 'cast').execute();
 */
import * as V1 from './V1/index.js';
export { StudioConfig } from './StudioConfig.js';
export const StudioV1 = V1.Studio;
