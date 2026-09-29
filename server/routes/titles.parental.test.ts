import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import RottenTomatoes from '@server/api/rating/rottentomatoes';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import type { SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { isAuthenticated } from '@server/middleware/auth';
import collectionRoutes from '@server/routes/collection';
import movieRoutes from '@server/routes/movie';
import personRoutes from '@server/routes/person';
import searchRoutes from '@server/routes/search';
import serviceRoutes from '@server/routes/service';
import tvRoutes from '@server/routes/tv';
import { setupTestDb } from '@server/test/db';
import {
  ALLOWED,
  BLOCKED_18,
  createTestApp,
  failingTitles,
  fakeMovieDetails,
  fakeRatings,
  fakeTvDetails,
  loginAs,
  resetParental,
  restrictUser,
} from '@server/test/parental';
import type { Express } from 'express';

let app: Express;

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

const UNKNOWN = 999;
stub('getMovie', (a) => {
  if (a.movieId === UNKNOWN) {
    throw new Error('[TMDB] Failed to fetch movie details: 404');
  }
  return fakeMovieDetails(Number(a.movieId));
});
stub('getTvShow', (a) => {
  if (a.tvId === UNKNOWN) {
    throw new Error('[TMDB] Failed to fetch TV show details: 404');
  }
  return fakeTvDetails(Number(a.tvId));
});
const listPage = (mediaType: 'movie' | 'tv', page = 1) => ({
  page,
  total_pages: 1,
  total_results: 2,
  results: [
    { id: 1, media_type: mediaType, title: 'ok', name: 'ok', genre_ids: [] },
    { id: 2, media_type: mediaType, title: 'no', name: 'no', genre_ids: [] },
  ],
});
stub('getMovieRecommendations', (a) => listPage('movie', Number(a.page) || 1));
stub('getMovieSimilar', (a) => listPage('movie', Number(a.page) || 1));
stub('getTvRecommendations', (a) => listPage('tv', Number(a.page) || 1));
stub('getTvSimilar', (a) => listPage('tv', Number(a.page) || 1));
stub('searchMulti', () => ({
  page: 1,
  total_pages: 1,
  total_results: 3,
  results: [
    { id: 1, media_type: 'movie', title: 'ok', genre_ids: [] },
    { id: 2, media_type: 'movie', title: 'no', genre_ids: [] },
    {
      id: 50,
      media_type: 'person',
      name: 'Actor',
      known_for: [
        { id: 1, media_type: 'movie', title: 'ok', genre_ids: [] },
        { id: 2, media_type: 'movie', title: 'no', genre_ids: [] },
      ],
    },
  ],
}));
stub('getPersonCombinedCredits', () => ({
  id: 50,
  cast: [
    {
      id: 1,
      media_type: 'movie',
      title: 'ok',
      character: 'a',
      credit_id: 'c1',
      genre_ids: [],
    },
    {
      id: 2,
      media_type: 'movie',
      title: 'no',
      character: 'b',
      credit_id: 'c2',
      genre_ids: [],
    },
  ],
  crew: [
    {
      id: 2,
      media_type: 'movie',
      title: 'no',
      job: 'Director',
      department: 'Directing',
      credit_id: 'c3',
      genre_ids: [],
    },
  ],
}));
stub('getCollection', () => ({
  id: 10,
  name: 'Saga',
  parts: [
    { id: 1, title: 'ok', genre_ids: [] },
    { id: 2, title: 'no', genre_ids: [] },
  ],
}));

// Real answers from the rating and Sonarr clients, so only the guard can fail a route
const rtRating = {
  title: 'ok',
  url: '',
  criticsScore: 90,
  criticsRating: 'Certified Fresh',
  year: 2020,
};
mock.method(RottenTomatoes.prototype, 'getMovieRatings', async () => rtRating);
mock.method(RottenTomatoes.prototype, 'getTVRatings', async () => rtRating);
mock.method(SonarrAPI.prototype, 'getSeriesByTitle', async () => []);

before(() => {
  app = createTestApp((app) => {
    app.use('/search', isAuthenticated(), searchRoutes);
    app.use('/movie', isAuthenticated(), movieRoutes);
    app.use('/tv', isAuthenticated(), tvRoutes);
    app.use('/person', isAuthenticated(), personRoutes);
    app.use('/collection', isAuthenticated(), collectionRoutes);
    app.use('/service', isAuthenticated(), serviceRoutes);
  });
});

setupTestDb();
beforeEach(() => {
  resetParental();
  for (const t of ['movie', 'tv']) {
    fakeRatings.set(`${t}:1`, ALLOWED);
    fakeRatings.set(`${t}:2`, BLOCKED_18);
  }
});

const admin = () => loginAs(app, 'admin@seerr.dev');
const demo = () => loginAs(app, 'demo@seerr.dev');
const ids = (results: { id: number }[]) => results.map((r) => r.id);

describe('titles for a restricted user', () => {
  const REFUSED = { status: 403, message: 'This title is not available.' };

  it('refuses blocked movie details with 403', async () => {
    await restrictUser('demo@seerr.dev', 10);
    const agent = await demo();
    const blocked = await agent.get('/movie/2');
    assert.equal(blocked.status, 403);
    assert.deepEqual(blocked.body, REFUSED);
    assert.equal((await agent.get('/movie/1')).status, 200);
    assert.equal((await agent.get(`/movie/${UNKNOWN}`)).status, 500);
  });

  it('refuses blocked series details and seasons with 403', async () => {
    await restrictUser('demo@seerr.dev', 10);
    const agent = await demo();
    for (const path of ['/tv/2', '/tv/2/season/1']) {
      const res = await agent.get(path);
      assert.equal(res.status, 403, path);
      assert.deepEqual(res.body, REFUSED, path);
    }
  });

  it('refuses a title whose rating lookup fails', async () => {
    await restrictUser('demo@seerr.dev', 10);
    failingTitles.add('movie:3');
    const res = await (await demo()).get('/movie/3');
    assert.equal(res.status, 403);
  });

  it('refuses ratings and the Sonarr lookup of a blocked title', async () => {
    await restrictUser('demo@seerr.dev', 10);
    getSettings().sonarr = [
      { id: 0, name: 'Sonarr', hostname: 'localhost', port: 8989, apiKey: 'k' },
    ] as SonarrSettings[];
    const agent = await demo();
    for (const path of [
      '/movie/2/ratings',
      '/movie/2/ratingscombined',
      '/tv/2/ratings',
      '/service/sonarr/lookup/2',
    ]) {
      const res = await agent.get(path);
      assert.equal(res.status, 403, path);
      assert.deepEqual(res.body, REFUSED, path);
    }
    getSettings().sonarr = [];
  });

  it('filters recommendations and similar titles', async () => {
    await restrictUser('demo@seerr.dev', 10);
    const agent = await demo();
    for (const path of [
      '/movie/1/recommendations',
      '/movie/1/similar',
      '/tv/1/recommendations',
      '/tv/1/similar',
    ]) {
      assert.deepEqual(ids((await agent.get(path)).body.results), [1], path);
    }
  });

  it('search keeps people but filters known_for', async () => {
    await restrictUser('demo@seerr.dev', 10);
    const res = await (await demo()).get('/search?query=x');
    assert.deepEqual(ids(res.body.results), [1, 50]);
    const person = res.body.results.find((r: { id: number }) => r.id === 50);
    assert.deepEqual(ids(person.knownFor), [1]);
  });

  it('filters person credits and collection parts', async () => {
    await restrictUser('demo@seerr.dev', 10);
    const agent = await demo();
    const credits = await agent.get('/person/50/combined_credits');
    assert.deepEqual(ids(credits.body.cast), [1]);
    assert.deepEqual(ids(credits.body.crew), []);
    const collection = await agent.get('/collection/10');
    assert.deepEqual(ids(collection.body.parts), [1]);
  });
});

describe('titles for a user without a profile', () => {
  it('sees everything', async () => {
    const agent = await admin();
    assert.equal((await agent.get('/movie/2')).status, 200);
    assert.deepEqual(
      ids((await agent.get('/search?query=x')).body.results),
      [1, 2, 50]
    );
    assert.deepEqual(
      ids((await agent.get('/collection/10')).body.parts),
      [1, 2]
    );
  });
});
