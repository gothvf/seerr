import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import TheMovieDb from '@server/api/themoviedb';
import cacheManager from '@server/lib/cache';
import { warmRatings } from '@server/lib/parental/warm';
import { setupTestDb } from '@server/test/db';
import {
  failingTitles,
  resetParental,
  restrictUser,
} from '@server/test/parental';

// Every list call made, as "<method> <args>"
const calls: string[] = [];

// Page p of a list: ids base + p*100 + 0..19, so a key names its list and page
const page = (base: number, p: number, mediaType?: 'movie' | 'tv') => ({
  page: p,
  total_pages: 50,
  total_results: 1000,
  results: Array.from({ length: 20 }, (_, i) => ({
    id: base + p * 100 + i,
    ...(mediaType ? { media_type: mediaType } : {}),
  })),
});

const stub = (
  method: string,
  impl: (args: Record<string, unknown>) => unknown
) =>
  Object.defineProperty(TheMovieDb.prototype, method, {
    get() {
      return async (args: Record<string, unknown> = {}) => {
        calls.push(`${method} ${JSON.stringify(args)}`);
        return impl(args);
      };
    },
    set() {},
    configurable: true,
  });

const p = (a: Record<string, unknown>) => Number(a.page) || 1;
stub('getAllTrending', (a) => page(100000, p(a), 'movie'));
stub('getDiscoverMovies', (a) =>
  a.genre
    ? page(600000 + Number(a.genre) * 1000, 1)
    : page(a.primaryReleaseDateGte ? 400000 : 200000, p(a))
);
stub('getDiscoverTv', (a) =>
  a.genre
    ? page(700000 + Number(a.genre) * 1000, 1)
    : page(a.firstAirDateGte ? 500000 : 300000, p(a))
);
stub('getMovieGenres', () => [{ id: 28, name: 'Action' }]);
stub('getTvGenres', () => [{ id: 16, name: 'Animation' }]);

const cached = (key: string) =>
  cacheManager.getCache('parental').data.get(key) !== undefined;

setupTestDb();
beforeEach(() => {
  resetParental();
  calls.length = 0;
});

describe('warmRatings', () => {
  it("looks up every title on the home rows' first pages", async () => {
    await restrictUser('demo@seerr.dev', 10);
    await warmRatings();
    for (const key of [
      'movie:100719', // trending, page 7
      'movie:200701', // popular movies, page 7
      'tv:300705', // popular series, page 7
      'movie:400703', // upcoming movies, page 7
      'tv:500702', // upcoming series, page 7
      'movie:628100', // action movies, page 1
      'tv:716100', // animated series, page 1
    ]) {
      assert.ok(cached(key), key);
    }
    assert.equal(cached('movie:200801'), false, 'read past page 7');
  });

  it('does nothing while no user has a profile', async () => {
    await warmRatings();
    assert.deepEqual(calls, []);
  });

  it('keeps going past a failed lookup', async () => {
    await restrictUser('demo@seerr.dev', 10);
    failingTitles.add('movie:200105');
    await warmRatings();
    assert.equal(cached('movie:200105'), false);
    assert.ok(cached('movie:200106'));
  });
});
