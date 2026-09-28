import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieReleaseResult,
  TmdbTvRatingResult,
} from '@server/api/themoviedb/interfaces';
import { MediaType } from '@server/constants/media';
import cacheManager from '@server/lib/cache';
import { getRatings } from '@server/lib/parental/ratings';

let calls = 0;

Object.defineProperty(TheMovieDb.prototype, 'getMovieReleaseDates', {
  get() {
    return async ({ movieId }: { movieId: number }) => {
      calls++;
      if (movieId === 500) throw new Error('TMDB down');
      return {
        results: [
          {
            iso_3166_1: 'FR',
            release_dates: [
              { certification: '', release_date: '', type: 1 },
              { certification: '12', release_date: '', type: 3 },
            ],
          },
          {
            iso_3166_1: 'US',
            release_dates: [{ certification: '', release_date: '', type: 3 }],
          },
        ],
      } as unknown as TmdbMovieReleaseResult;
    };
  },
  set() {},
  configurable: true,
});

Object.defineProperty(TheMovieDb.prototype, 'getTvContentRatings', {
  get() {
    return async () => {
      calls++;
      return {
        results: [
          { iso_3166_1: 'US', rating: 'TV-Y7' },
          { iso_3166_1: 'DE', rating: '' },
        ],
      } as TmdbTvRatingResult;
    };
  },
  set() {},
  configurable: true,
});

beforeEach(() => {
  calls = 0;
  cacheManager.getCache('parental').flush();
});

describe('getRatings', () => {
  it('keeps non-empty movie certifications per country', async () => {
    assert.deepEqual(await getRatings(MediaType.MOVIE, 1), { FR: ['12'] });
  });

  it('reads TV content ratings', async () => {
    assert.deepEqual(await getRatings(MediaType.TV, 2), { US: ['TV-Y7'] });
  });

  it('caches a title', async () => {
    await getRatings(MediaType.MOVIE, 1);
    await getRatings(MediaType.MOVIE, 1);
    assert.equal(calls, 1);
  });

  it('throws on a TMDB failure and does not cache it', async () => {
    await assert.rejects(getRatings(MediaType.MOVIE, 500), /TMDB down/);
    await assert.rejects(getRatings(MediaType.MOVIE, 500), /TMDB down/);
    assert.equal(calls, 2);
  });
});
