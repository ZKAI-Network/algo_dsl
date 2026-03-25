const defaultBaseUrl = 'https://api.mbd.xyz/v3/studio';

/** API config: apiKey required; commonUrl (single base) or servicesUrl (per-service) for endpoints. */
export class StudioConfig {
  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('StudioConfig: options object is required');
    }
    const { apiKey, commonUrl, servicesUrl, log, show } = options;
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('StudioConfig: apiKey is required and must be a non-empty string');
    }
    const hasCommonUrl = typeof commonUrl === 'string' && commonUrl.trim().length > 0;
    if (hasCommonUrl) {
      const url = commonUrl.trim().replace(/\/$/, '');
      this.searchService = url;
      this.storiesService = url;
      this.featuresService = url;
      this.scoringService = url;
      this.rankingService = url;
    } else if (servicesUrl && typeof servicesUrl === 'object') {
      const { searchService, storiesService, featuresService, scoringService, rankingService } = servicesUrl;
      const services = { searchService, storiesService, featuresService, scoringService, rankingService };
      const missing = Object.entries(services)
        .filter(([, v]) => typeof v !== 'string' || !v.trim())
        .map(([k]) => k);
      if (missing.length > 0) {
        throw new Error(`StudioConfig: when using servicesUrl, all service URLs are required. Missing or invalid: ${missing.join(', ')}`);
      }
      this.searchService = searchService.trim().replace(/\/$/, '');
      this.storiesService = storiesService.trim().replace(/\/$/, '');
      this.featuresService = featuresService.trim().replace(/\/$/, '');
      this.scoringService = scoringService.trim().replace(/\/$/, '');
      this.rankingService = rankingService.trim().replace(/\/$/, '');
    } else {
      this.searchService = defaultBaseUrl;
      this.storiesService = defaultBaseUrl;
      this.featuresService = defaultBaseUrl;
      this.scoringService = defaultBaseUrl;
      this.rankingService = defaultBaseUrl;
    }
    this.apiKey = apiKey.trim();
    this.log = typeof log === 'function' ? log : console.log.bind(console);
    this.show = typeof show === 'function' ? show : console.log.bind(console);
  }
}
