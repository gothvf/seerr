import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import { isAuthenticated } from '@server/middleware/auth';
import discoverRoutes from '@server/routes/discover';
import { setupTestDb } from '@server/test/db';
import {
  ALLOWED,
  BLOCKED_18,
  createTestApp,
  fakeRatings,
  loadUser,
  loginAs,
  resetParental,
  restrictUser,
} from '@server/test/parental';
import type { Express } from 'express';

let app: Express;
const calls: { method: string; page?: number }[] = [];

// Source page p: ids p*100 .. p*100+19, even ids all ages, odd ids 18.
function fakePage(method: string, mediaType: 'movie' | 'tv', page = 1) {
  calls.push({ method, page });
  const results: Record<string, unknown>[] = Array.from(
    { length: 20 },
    (_, i) => {
      const id = page * 100 + i;
      fakeRatings.set(`${mediaType}:${id}`, i % 2 === 0 ? ALLOWED : BLOCKED_18);
      return {
        id,
        media_type: mediaType,
        title: `Title ${id}`,
        name: `Title ${id}`,
        backdrop_path: `/b${id}.jpg`,
        genre_ids: [],
      };
    }
  );
  return { page, total_pages: 10, total_results: 200, results };
}

const stub = (
  method: string,
  impl: (args: Record<string, unknown>) => unknown
) =>
  Object.defineProperty(TheMovieDb.prototype, method, {
    get() {
      return async (args: Record<string, unknown> = {}) => impl(args);
    },
    set() {},
    configurable: true,
  });

for (const m of [
  'getDiscoverMovies',
  'getMovieTrending',
  'getMoviesByKeyword',
]) {
  stub(m, (a) => fakePage(m, 'movie', Number(a.page) || 1));
}
for (const m of ['getDiscoverTv', 'getTvTrending']) {
  stub(m, (a) => fakePage(m, 'tv', Number(a.page) || 1));
}
stub('getAllTrending', (a) => {
  const page = fakePage('getAllTrending', 'movie', Number(a.page) || 1);
  page.results[19] = { id: 7, media_type: 'person', known_for: [], name: 'P' };
  return page;
});
stub('getLanguages', () => [
  { iso_639_1: 'fr', english_name: 'French', name: 'Français' },
]);
stub('getMovieGenres', () => [{ id: 28, name: 'Action' }]);
stub('getTvGenres', () => [{ id: 10759, name: 'Action' }]);
stub('getStudio', () => ({ id: 1, name: 'Studio' }));
stub('getNetwork', () => ({ id: 1, name: 'Network' }));
stub('getKeywordDetails', () => ({ id: 1, name: 'kw' }));

const LISTS = [
  '/discover/movies',
  '/discover/movies/language/fr',
  '/discover/movies/genre/28',
  '/discover/movies/studio/1',
  '/discover/movies/upcoming',
  '/discover/tv',
  '/discover/tv/language/fr',
  '/discover/tv/genre/10759',
  '/discover/tv/network/1',
  '/discover/tv/upcoming',
  '/discover/trending',
  '/discover/keyword/1/movies',
];

before(() => {
  app = createTestApp((app) => {
    app.use('/discover', isAuthenticated(), discoverRoutes);
  });
});

setupTestDb();
beforeEach(() => {
  resetParental();
  calls.length = 0;
});

const admin = () => loginAs(app, 'admin@seerr.dev');
const demo = () => loginAs(app, 'demo@seerr.dev');

describe('discover for a restricted user', () => {
  for (const path of LISTS) {
    it(`${path} returns 20 titles, none above the age`, async () => {
      await restrictUser('demo@seerr.dev', 10);
      const res = await (await demo()).get(path);
      assert.equal(res.status, 200);
      const titles = res.body.results.filter(
        (r: { mediaType: string }) => r.mediaType !== 'person'
      );
      assert.ok(titles.length >= 19, `${titles.length} titles`);
      assert.ok(
        titles.every((r: { id: number }) => r.id % 2 === 0),
        'an 18-rated title leaked'
      );
    });
  }

  it('reads source pages 3 and 4 for page 2', async () => {
    await restrictUser('demo@seerr.dev', 10);
    const res = await (await demo()).get('/discover/movies?page=2');
    assert.deepEqual(
      calls.map((c) => c.page),
      [3, 4]
    );
    assert.equal(res.body.page, 2);
    assert.equal(res.body.totalPages, 5);
  });

  it('keeps people in trending', async () => {
    await restrictUser('demo@seerr.dev', 10);
    const res = await (await demo()).get('/discover/trending');
    assert.ok(
      res.body.results.some(
        (r: { mediaType: string }) => r.mediaType === 'person'
      )
    );
  });

  it('builds genre slider backdrops from allowed titles only', async () => {
    await restrictUser('demo@seerr.dev', 10);
    for (const path of [
      '/discover/genreslider/movie',
      '/discover/genreslider/tv',
    ]) {
      const res = await (await demo()).get(path);
      const backdrops: string[] = res.body[0].backdrops;
      assert.ok(backdrops.length > 0, path);
      assert.ok(
        backdrops.every((b) => Number(b.match(/\d+/)?.[0]) % 2 === 0),
        `${path}: an 18-rated backdrop leaked`
      );
    }
  });

  it('filters the watchlist', async () => {
    await restrictUser('demo@seerr.dev', 10);
    // Seeded users are Plex users; without a token the local watchlist is read
    await getRepository(User).update(
      { email: 'demo@seerr.dev' },
      { plexToken: null }
    );
    const kid = await loadUser('demo@seerr.dev');
    fakeRatings.set('movie:1', ALLOWED);
    fakeRatings.set('movie:2', BLOCKED_18);
    for (const tmdbId of [1, 2]) {
      const media = await getRepository(Media).save(
        new Media({
          mediaType: MediaType.MOVIE,
          tmdbId,
          status: MediaStatus.UNKNOWN,
          status4k: MediaStatus.UNKNOWN,
        })
      );
      await getRepository(Watchlist).save(
        new Watchlist({
          tmdbId,
          mediaType: MediaType.MOVIE,
          title: `t${tmdbId}`,
          ratingKey: '',
          requestedBy: kid,
          media,
        })
      );
    }
    const res = await (await demo()).get('/discover/watchlist');
    assert.deepEqual(
      res.body.results.map((r: { tmdbId: number }) => r.tmdbId),
      [1]
    );
  });
});

describe('discover for a user without a profile', () => {
  it('returns the source page untouched with one TMDB call', async () => {
    const res = await (await admin()).get('/discover/movies?page=2');
    assert.deepEqual(
      calls.map((c) => c.page),
      [2]
    );
    assert.equal(res.body.results.length, 20);
    assert.equal(res.body.totalPages, 10);
  });
});
