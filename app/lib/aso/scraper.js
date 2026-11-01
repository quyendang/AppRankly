const axios = require("axios");
const gplayModule = require("google-play-scraper");
const gplay = gplayModule.default || gplayModule;
const resolver = require("../resolver");
const { withTimeout } = require("../utils/timeout");

const mainScraper = require("../scraper");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatCachedPlayData(cached, appId) {
  if (!cached) return null;
  return {
    appId: appId || cached.appId || "",
    title: cached.title || "",
    summary: cached.summary || "",
    description: cached.description || cached.descriptionHTML || "",
    developer: cached.developer || cached.developerId || "",
    category: cached.genre || cached.category || "",
    icon: cached.icon || cached.iconUrl || "",
    iconUrl: cached.iconUrl || cached.icon || "",
    url: cached.url || "",
    headerImage: cached.headerImage || "",
    screenshots: cached.screenshots || [],
    score: cached.score || 0,
    ratings: cached.ratings || 0,
    reviews: cached.reviews || 0,
    installs: cached.installs || "",
    minInstalls: cached.minInstalls || 0,
    priceText: cached.priceText || (cached.free ? "Free" : ""),
    contentRating: cached.contentRating || "",
    updated: cached.updated
      ? new Date(cached.updated).toISOString()
      : new Date().toISOString(),
    version: cached.version || "",
    recentChanges: cached.recentChanges || "",
    privacyPolicy: cached.privacyPolicy || "",
    isCached: true,
  };
}

/**
 * Detailed Google Play listing fetch with cached fallback
 */
async function getPlayListing(appId, options = {}) {
  const force = Boolean(options?.force);
  if (!force) {
    const existingCache = mainScraper.getCachedStoreData(appId, "google");
    if (existingCache && existingCache.title) {
      return formatCachedPlayData(existingCache, appId);
    }
  }

  try {
    const raw = await withTimeout(
      gplay.app({ appId }),
      7000,
      `Play Store scraper timed out for ${appId}`,
    );
    if (!raw) {
      try {
        const fallback = await withTimeout(
          mainScraper.getScrapedPlayStoreData(appId),
          7000,
        );
        return formatCachedPlayData(fallback, appId);
      } catch (_) {
        const cached = mainScraper.getCachedStoreData(appId, "google");
        return formatCachedPlayData(cached, appId);
      }
    }

    const listing = {
      appId: raw.appId,
      title: raw.title || "",
      summary: raw.summary || raw.shortDescription || "",
      description: raw.description || "",
      developer: raw.developer || raw.developerId || "",
      category: raw.genre || raw.genreId || "",
      icon: raw.icon || "",
      iconUrl: raw.icon || "",
      url: raw.url || "",
      headerImage: raw.headerImage || "",
      screenshots: raw.screenshots || [],
      score: raw.score || 0,
      ratings: raw.ratings || 0,
      reviews: raw.reviews || 0,
      installs: raw.installs || "",
      minInstalls: raw.minInstalls || 0,
      priceText: raw.priceText || (raw.free ? "Free" : "$" + raw.price),
      contentRating: raw.contentRating || "",
      updated: raw.updated
        ? new Date(raw.updated).toISOString()
        : new Date().toISOString(),
      version: raw.version || "",
      recentChanges: raw.recentChanges || "",
      privacyPolicy: raw.privacyPolicy || "",
      isCached: false,
    };

    return listing;
  } catch (err) {
    console.warn(
      `[ASO Scraper] Play listing fetch failed for ${appId}, falling back to cache:`,
      err.message,
    );
    try {
      const fallback = await withTimeout(
        mainScraper.getScrapedPlayStoreData(appId),
        7000,
      );
      return formatCachedPlayData(fallback, appId);
    } catch (_) {
      const cached = mainScraper.getCachedStoreData(appId, "google");
      return formatCachedPlayData(cached, appId);
    }
  }
}

async function getPlaySuggest(term, country = "us", lang = "en") {
  try {
    return await withTimeout(gplay.suggest({ term, country, lang }), 7000);
  } catch (err) {
    console.warn(
      `[ASO Scraper] Play suggest failed for term "${term}":`,
      err.message,
    );
    return [];
  }
}

async function getPlaySearch(
  term,
  num = 30,
  country = "us",
  lang = "en",
  options = {},
) {
  try {
    return await withTimeout(gplay.search({ term, num, country, lang }), 7000);
  } catch (err) {
    if (options.strict) throw new Error("RANK_SOURCE_FAILED");
    console.warn(
      `[ASO Scraper] Play search failed for term "${term}":`,
      err.message,
    );
    return [];
  }
}

async function getPlaySimilar(appId) {
  try {
    const list = await withTimeout(gplay.similar({ appId }), 7000);
    return (list || []).map((raw) => ({
      appId: raw.appId,
      title: raw.title || "",
      summary: raw.summary || "",
      developer: raw.developer || "",
      score: raw.score || 0,
      icon: raw.icon || "",
      priceText: raw.priceText || (raw.free ? "Free" : ""),
      installs: raw.installs || "",
    }));
  } catch (err) {
    console.warn(
      `[ASO Scraper] Play similar failed for ${appId}:`,
      err.message,
    );
    return [];
  }
}

async function getPlayReviews(appId, num = 100, country = "us") {
  try {
    const res = await withTimeout(
      gplay.reviews({ appId, num, country, sort: gplay.sort.NEWEST }),
      7000,
    );
    return res.data || [];
  } catch (err) {
    console.warn(
      `[ASO Scraper] Play reviews failed for ${appId}:`,
      err.message,
    );
    return [];
  }
}

/**
 * Detailed iTunes Search & Lookup API wrappers
 */
async function getAppleSearch(term, country = "us", limit = 30, options = {}) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=${country}&limit=${limit}`;
    const resp = await axios.get(url, { timeout: 8000 });
    return (resp.data?.results || []).map(formatAppleRawData);
  } catch (err) {
    if (options.strict) throw new Error("RANK_SOURCE_FAILED");
    console.warn(
      `[ASO Scraper] Apple search failed for term "${term}":`,
      err.message,
    );
    return [];
  }
}

function formatCachedAppleData(cached, id) {
  if (!cached) return null;
  const subtitle = cached.subtitle || "";
  const promo = cached.promotionalText || "";
  const summary =
    cached.summary ||
    subtitle ||
    promo ||
    (cached.description ? cached.description.substring(0, 170).trim() : "");
  const icon = cached.iconUrl || cached.icon || "";
  return {
    trackId: cached.adamId || cached.trackId || id,
    bundleId: cached.bundleId || id,
    title: cached.title || cached.trackName || "",
    trackName: cached.trackName || cached.title || "",
    subtitle: subtitle,
    promotionalText: promo,
    summary,
    description: cached.description || cached.descriptionHTML || "",
    developer: cached.developer || cached.sellerName || cached.artistName || "",
    category: cached.genre || cached.category || "",
    icon,
    iconUrl: icon,
    url: cached.url || cached.trackViewUrl || "",
    trackViewUrl: cached.trackViewUrl || cached.url || "",
    screenshots: cached.screenshots || [],
    score: cached.score || 0,
    ratings: cached.ratings || cached.reviews || 0,
    priceText: cached.priceText || (cached.free ? "Free" : ""),
    contentRating: cached.contentRating || "",
    version: cached.version || "",
    releaseNotes: cached.releaseNotes || "",
    updated: cached.updated || new Date().toISOString(),
    isCached: true,
  };
}

async function getAppleLookup(trackIdOrBundleId, options = {}) {
  if (!trackIdOrBundleId) return null;
  const force = Boolean(options?.force);
  if (!force) {
    const existingCache = mainScraper.getCachedStoreData(
      trackIdOrBundleId,
      "apple",
    );
    if (existingCache && (existingCache.title || existingCache.trackName)) {
      if (
        !existingCache.subtitle &&
        (existingCache.url || existingCache.trackViewUrl)
      ) {
        try {
          const fallback = await withTimeout(
            mainScraper.getScrapedAppleStoreData(trackIdOrBundleId),
            8000,
          );
          if (fallback)
            return formatCachedAppleData(fallback, trackIdOrBundleId);
        } catch (_) {}
      }
      return formatCachedAppleData(existingCache, trackIdOrBundleId);
    }
  }

  const cacheKey = force ? `scrape:apple:${Date.now()}` : "scrape:apple";
  return resolver.resolve(
    cacheKey,
    { identifier: trackIdOrBundleId },
    async () => {
      try {
        const isNumeric = /^\d+$/.test(trackIdOrBundleId);
        const url = isNumeric
          ? `https://itunes.apple.com/lookup?id=${trackIdOrBundleId}`
          : `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(trackIdOrBundleId)}`;

        const resp = await axios.get(url, { timeout: 8000 });
        const raw = resp.data?.results?.[0];
        if (raw) {
          if (!raw.subtitle && raw.trackViewUrl) {
            try {
              const pageDetails = await mainScraper.scrapeAppleWebPageDetails(
                raw.trackViewUrl,
              );
              raw.subtitle = pageDetails.subtitle;
              raw.promotionalText = pageDetails.promotionalText;
            } catch (_) {}
          }
          return formatAppleRawData(raw);
        }

        // If lookup returned 0 results, check cached scraped data
        try {
          const fallback = await withTimeout(
            mainScraper.getScrapedAppleStoreData(trackIdOrBundleId),
            8000,
          );
          return formatCachedAppleData(fallback, trackIdOrBundleId);
        } catch (_) {
          const cached = mainScraper.getCachedStoreData(
            trackIdOrBundleId,
            "apple",
          );
          return formatCachedAppleData(cached, trackIdOrBundleId);
        }
      } catch (err) {
        console.warn(
          `[ASO Scraper] Apple lookup failed for ${trackIdOrBundleId}, falling back to cache:`,
          err.message,
        );
        try {
          const fallback = await withTimeout(
            mainScraper.getScrapedAppleStoreData(trackIdOrBundleId),
            8000,
          );
          return formatCachedAppleData(fallback, trackIdOrBundleId);
        } catch (_) {
          const cached = mainScraper.getCachedStoreData(
            trackIdOrBundleId,
            "apple",
          );
          return formatCachedAppleData(cached, trackIdOrBundleId);
        }
      }
    },
  );
}

function formatAppleRawData(raw) {
  const subtitle = raw.subtitle || "";
  const promo = raw.promotionalText || "";
  const summary =
    subtitle ||
    promo ||
    (raw.description ? raw.description.substring(0, 170).trim() : "");
  const iconUrl =
    raw.artworkUrl512 || raw.artworkUrl100 || raw.artworkUrl60 || "";

  return {
    trackId: raw.trackId,
    bundleId: raw.bundleId,
    title: raw.trackName || "",
    trackName: raw.trackName || "",
    subtitle: subtitle,
    promotionalText: promo,
    summary: summary,
    description: raw.description || "",
    developer: raw.artistName || raw.sellerName || "",
    category: raw.primaryGenreName || "",
    icon: iconUrl,
    iconUrl: iconUrl,
    url: raw.trackViewUrl || "",
    trackViewUrl: raw.trackViewUrl || "",
    screenshots: raw.screenshotUrls || [],
    score: raw.averageUserRating || 0,
    ratings: raw.userRatingCount || 0,
    priceText:
      raw.formattedPrice || (raw.price === 0 ? "Free" : "$" + raw.price),
    contentRating: raw.trackContentRating || "",
    version: raw.version || "",
    releaseNotes: raw.releaseNotes || "",
    updated:
      raw.currentVersionReleaseDate ||
      raw.releaseDate ||
      new Date().toISOString(),
  };
}

async function getAppleReviewsRSS(trackIdOrBundleId, country = "us") {
  try {
    let numericTrackId = trackIdOrBundleId;
    if (!/^\d+$/.test(String(trackIdOrBundleId))) {
      const appInfo = await getAppleLookup(trackIdOrBundleId);
      if (appInfo && appInfo.trackId) {
        numericTrackId = appInfo.trackId;
      }
    }
    const url = `https://itunes.apple.com/${country}/rss/customerreviews/id=${numericTrackId}/sortBy=mostRecent/json`;
    const resp = await axios.get(url, { timeout: 8000 });
    const entries = resp.data?.feed?.entry || [];
    const reviews = [];
    for (const e of entries) {
      if (e["im:name"]) continue;
      reviews.push({
        id: e.id?.label || `apple_${Date.now()}_${Math.random()}`,
        author: e.author?.name?.label || "Anonymous",
        title: e.title?.label || "",
        body: e.content?.label || "",
        rating: parseInt(e["im:rating"]?.label || "5", 10),
        version: e["im:version"]?.label || "",
        reviewDate: new Date().toISOString(),
      });
    }
    return reviews;
  } catch (err) {
    console.warn(
      `[ASO Scraper] Apple RSS reviews failed for ${trackIdOrBundleId}:`,
      err.message,
    );
    return [];
  }
}

/**
 * Expand keywords using autocomplete fan-out (a-z mining)
 */
async function expandKeywordsAutocomplete(
  seeds,
  store = "play",
  country = "us",
  lang = "en",
) {
  const discovered = new Set();
  const seedList = Array.isArray(seeds) ? seeds : [seeds];

  for (const seed of seedList) {
    if (!seed || !seed.trim()) continue;
    const baseSuggestions =
      store === "play"
        ? await getPlaySuggest(seed, country, lang)
        : (await getAppleSearch(seed, country, 10)).map(
            (item) => item.trackName,
          );

    baseSuggestions.forEach((s) => discovered.add(s.toLowerCase().trim()));
    await sleep(200);

    const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
    for (const char of alphabet) {
      const query = `${seed} ${char}`;
      if (store === "play") {
        const list = await getPlaySuggest(query, country, lang);
        list.forEach((s) => discovered.add(s.toLowerCase().trim()));
      }
      await sleep(150);
    }
  }

  return Array.from(discovered);
}

module.exports = {
  getPlayListing,
  getPlaySuggest,
  getPlaySearch,
  getPlaySimilar,
  getPlayReviews,
  getAppleSearch,
  getAppleLookup,
  getAppleReviewsRSS,
  expandKeywordsAutocomplete,
};
