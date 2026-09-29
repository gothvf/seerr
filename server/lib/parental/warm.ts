import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { UserSettings } from '@server/entity/UserSettings';
import type { TitleLike } from '@server/lib/parental';
import { FIRST_PAGE_SOURCES } from '@server/lib/parental';
import { getRatings } from '@server/lib/parental/ratings';
import logger from '@server/logger';
import { createTmdbWithRegionLanguage } from '@server/routes/discover';
import { IsNull, Not } from 'typeorm';

interface ListPage {
  total_pages: number;
  results: TitleLike[];
}

let running = false;

export const isWarmingRatings = (): boolean => running;

const lookUp = async (items: TitleLike[], fallback?: MediaType) => {
  await Promise.all(
    items.map(async (item) => {
      const kind = item.media_type ?? fallback;
      if (kind !== MediaType.MOVIE && kind !== MediaType.TV) {
        return;
      }
      try {
        await getRatings(kind, item.id);
      } catch {
        // Left uncached: the user's own lookup retries it
      }
    })
  );
};

/**
 * Looks up the ratings of the titles on the home rows' first pages (trending, popular,
 * upcoming, genre sliders), so restricted users' rows load from the cache. The cache
 * lives in memory, so this also runs at startup.
 */
export const warmRatings = async (): Promise<void> => {
  if (running) {
    return;
  }
  const restricted = await getRepository(UserSettings).count({
    where: { parentalProfile: { id: Not(IsNull()) } },
  });
  if (restricted === 0) {
    return;
  }

  running = true;
  const started = Date.now();
  try {
    const tmdb = createTmdbWithRegionLanguage();
    const now = new Date();
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const lists: [(page: number) => Promise<ListPage>, MediaType?][] = [
      [(page) => tmdb.getAllTrending({ page, timeWindow: 'day' })],
      [(page) => tmdb.getDiscoverMovies({ page }), MediaType.MOVIE],
      [(page) => tmdb.getDiscoverTv({ page }), MediaType.TV],
      [
        (page) =>
          tmdb.getDiscoverMovies({ page, primaryReleaseDateGte: today }),
        MediaType.MOVIE,
      ],
      [
        (page) => tmdb.getDiscoverTv({ page, firstAirDateGte: today }),
        MediaType.TV,
      ],
    ];

    for (const [fetchPage, fallback] of lists) {
      for (let page = 1; page <= FIRST_PAGE_SOURCES; page++) {
        const data = await fetchPage(page);
        await lookUp(data.results, fallback);
        if (page >= data.total_pages) {
          break;
        }
      }
    }
    for (const genre of await tmdb.getMovieGenres()) {
      const data = await tmdb.getDiscoverMovies({ genre: genre.id.toString() });
      await lookUp(data.results, MediaType.MOVIE);
    }
    for (const genre of await tmdb.getTvGenres()) {
      const data = await tmdb.getDiscoverTv({ genre: genre.id.toString() });
      await lookUp(data.results, MediaType.TV);
    }

    logger.info('Parental ratings warmed', {
      label: 'Parental Controls',
      seconds: Math.round((Date.now() - started) / 1000),
    });
  } catch (e) {
    logger.warn('Parental ratings warm-up stopped', {
      label: 'Parental Controls',
      errorMessage: e.message,
    });
  } finally {
    running = false;
  }
};
