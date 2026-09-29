import { MediaType } from '@server/constants/media';
import type { User } from '@server/entity/User';
import { isRatingAllowed } from '@server/lib/parental/ages';
import { getRatings } from '@server/lib/parental/ratings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

export class ParentalRestrictionError extends Error {}

// A restricted user's page N reads source pages 2N-1 and 2N, then reads ahead while
// it has fewer than PAGE_SIZE titles (the web client stops scrolling on a short page).
const SOURCE_PAGES_PER_PAGE = 2;
const MAX_READ_AHEAD = 5;
const PAGE_SIZE = 20;
/** The most source pages a restricted user's first page reads. */
export const FIRST_PAGE_SOURCES = SOURCE_PAGES_PER_PAGE + MAX_READ_AHEAD;
// TMDB serves pages 1 to 500 only, whatever total_pages says.
const TMDB_LAST_PAGE = 500;

export interface TitleLike {
  id: number;
  media_type?: string;
  adult?: boolean;
}

interface SourcePage<T> {
  page: number;
  total_pages: number;
  total_results: number;
  results: T[];
}

const isRestricted = (user?: User): boolean =>
  !!user?.settings?.parentalProfile;

const mediaTypeOf = (kind?: string): MediaType | undefined =>
  kind === MediaType.MOVIE
    ? MediaType.MOVIE
    : kind === MediaType.TV
      ? MediaType.TV
      : undefined;

export const isTitleAllowed = async (
  user: User | undefined,
  mediaType: MediaType,
  tmdbId: number,
  adult = false
): Promise<boolean> => {
  const profile = user?.settings?.parentalProfile;
  if (!profile) {
    return true;
  }

  try {
    const ratings = await getRatings(mediaType, tmdbId);
    return isRatingAllowed(
      { mediaType, ratings, adult },
      getSettings().parental.countries,
      profile
    );
  } catch (e) {
    logger.warn('Hiding a title whose ratings could not be fetched', {
      label: 'Parental Controls',
      mediaType,
      tmdbId,
      errorMessage: e.message,
    });
    return false;
  }
};

export const assertTitleAllowed = async (
  user: User | undefined,
  mediaType: MediaType,
  tmdbId: number,
  adult?: boolean
): Promise<void> => {
  if (!(await isTitleAllowed(user, mediaType, tmdbId, adult))) {
    throw new ParentalRestrictionError('This title is not available.');
  }
};

export const filterTitles = async <T extends TitleLike>(
  user: User | undefined,
  items: T[],
  fallback?: MediaType
): Promise<T[]> => {
  if (!isRestricted(user)) {
    return items;
  }

  const keep = await Promise.all(
    items.map(async (item) => {
      const kind = item.media_type ?? fallback;
      const mediaType = mediaTypeOf(kind);
      if (mediaType) {
        return isTitleAllowed(user, mediaType, item.id, item.adult);
      }
      if (kind === 'person') {
        const person = item as T & { known_for?: TitleLike[] };
        if (person.known_for) {
          person.known_for = await filterTitles(user, person.known_for);
        }
        return true;
      }
      // Collections only link to their parts, which the collection route filters.
      return kind === 'collection';
    })
  );

  return items.filter((_, i) => keep[i]);
};

export const filterMedia = async <T>(
  user: User | undefined,
  items: T[],
  titleOf: (item: T) => { mediaType: MediaType; tmdbId: number }
): Promise<T[]> => {
  if (!isRestricted(user)) {
    return items;
  }

  const keep = await Promise.all(
    items.map((item) => {
      const { mediaType, tmdbId } = titleOf(item);
      return isTitleAllowed(user, mediaType, tmdbId);
    })
  );

  return items.filter((_, i) => keep[i]);
};

export const parentalPage = async <
  T extends TitleLike,
  P extends SourcePage<T>,
>(
  user: User | undefined,
  page: number,
  fetchPage: (sourcePage: number) => Promise<P>,
  fallback?: MediaType
): Promise<P> => {
  if (!isRestricted(user)) {
    return fetchPage(page);
  }

  const pageNumber = Number.isInteger(page) && page > 0 ? page : 1;
  const first = (pageNumber - 1) * SOURCE_PAGES_PER_PAGE + 1;
  const firstData = await fetchPage(first);
  const lastSource = Math.min(firstData.total_pages, TMDB_LAST_PAGE);
  const strideEnd = first + SOURCE_PAGES_PER_PAGE - 1;

  const seen = new Set<string>();
  const results: T[] = [];
  const add = async (data: P) => {
    for (const item of await filterTitles(user, data.results, fallback)) {
      const key = `${item.media_type ?? fallback}:${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(item);
      }
    }
  };

  await add(firstData);
  for (
    let p = first + 1;
    p <= Math.min(lastSource, strideEnd + MAX_READ_AHEAD);
    p++
  ) {
    if (p > strideEnd && results.length >= PAGE_SIZE) {
      break;
    }
    await add(await fetchPage(p));
  }

  return {
    ...firstData,
    page: pageNumber,
    total_pages: Math.ceil(lastSource / SOURCE_PAGES_PER_PAGE),
    results,
  } as P;
};
