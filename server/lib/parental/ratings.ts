import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import cacheManager from '@server/lib/cache';
import type { TitleRatings } from '@server/lib/parental/ages';

// One client for every lookup: each TheMovieDb instance has its own rate limiter.
let tmdb: TheMovieDb | undefined;
const client = (): TheMovieDb => (tmdb ??= new TheMovieDb());

const add = (ratings: TitleRatings, country: string, rating: string) => {
  if (rating) {
    ratings[country] = [...(ratings[country] ?? []), rating];
  }
};

export const getRatings = async (
  mediaType: MediaType,
  tmdbId: number
): Promise<TitleRatings> => {
  const cache = cacheManager.getCache('parental').data;
  const key = `${mediaType}:${tmdbId}`;
  const cached = cache.get<TitleRatings>(key);
  if (cached) {
    return cached;
  }

  const ratings: TitleRatings = {};
  if (mediaType === MediaType.MOVIE) {
    const { results } = await client().getMovieReleaseDates({
      movieId: tmdbId,
    });
    for (const release of results) {
      for (const date of release.release_dates) {
        add(ratings, release.iso_3166_1, date.certification);
      }
    }
  } else {
    const { results } = await client().getTvContentRatings({ tvId: tmdbId });
    for (const rating of results) {
      add(ratings, rating.iso_3166_1, rating.rating);
    }
  }

  cache.set(key, ratings);
  return ratings;
};
