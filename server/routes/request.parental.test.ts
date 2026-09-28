import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import TautulliAPI from '@server/api/tautulli';
import TheMovieDb from '@server/api/themoviedb';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import { Permission } from '@server/lib/permissions';
import type { TautulliSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { isAuthenticated } from '@server/middleware/auth';
import blocklistRoutes from '@server/routes/blocklist';
import mediaRoutes from '@server/routes/media';
import requestRoutes from '@server/routes/request';
import userRoutes from '@server/routes/user';
import watchlistRoutes from '@server/routes/watchlist';
import { setupTestDb } from '@server/test/db';
import {
  ALLOWED,
  BLOCKED_18,
  createTestApp,
  fakeMovieDetails,
  fakeRatings,
  loadUser,
  loginAs,
  resetParental,
  restrictUser,
} from '@server/test/parental';
import type { Express } from 'express';

let app: Express;

mock.method(MediaRequest, 'sendNotification', async () => undefined);
Object.defineProperty(TheMovieDb.prototype, 'getMovie', {
  get() {
    return async ({ movieId }: { movieId: number }) =>
      fakeMovieDetails(movieId);
  },
  set() {},
  configurable: true,
});

before(() => {
  app = createTestApp((app) => {
    app.use('/request', isAuthenticated(), requestRoutes);
    app.use('/watchlist', isAuthenticated(), watchlistRoutes);
    app.use('/media', isAuthenticated(), mediaRoutes);
    app.use('/user', isAuthenticated(), userRoutes);
    app.use('/blocklist', isAuthenticated(), blocklistRoutes);
  });
});

setupTestDb();
beforeEach(() => {
  resetParental();
  fakeRatings.set('movie:1', ALLOWED);
  fakeRatings.set('movie:2', BLOCKED_18);
});

const admin = () => loginAs(app, 'admin@seerr.dev');
const demo = () => loginAs(app, 'demo@seerr.dev');

const saveMedia = (tmdbId: number, extra: Partial<Media> = {}) =>
  getRepository(Media).save(
    new Media({
      mediaType: MediaType.MOVIE,
      tmdbId,
      status: MediaStatus.PENDING,
      status4k: MediaStatus.UNKNOWN,
      ...extra,
    })
  );

async function seedRequest(tmdbId: number, email: string) {
  const requestedBy = await loadUser(email);
  return getRepository(MediaRequest).save(
    new MediaRequest({
      type: MediaType.MOVIE,
      status: MediaRequestStatus.PENDING,
      media: await saveMedia(tmdbId),
      requestedBy,
      is4k: false,
    })
  );
}

describe('requests', () => {
  it('refuses a restricted user a blocked title', async () => {
    await restrictUser('demo@seerr.dev', 10);
    const res = await (await demo())
      .post('/request')
      .send({ mediaType: 'movie', mediaId: 2 });
    assert.equal(res.status, 403);
    assert.equal(await getRepository(MediaRequest).count(), 0);
  });

  it('accepts a restricted user an allowed title', async () => {
    await restrictUser('demo@seerr.dev', 10);
    const res = await (await demo())
      .post('/request')
      .send({ mediaType: 'movie', mediaId: 1 });
    assert.equal(res.status, 201);
  });

  it("refuses an admin requesting a blocked title on a kid's behalf", async () => {
    await restrictUser('demo@seerr.dev', 10);
    const kid = await loadUser('demo@seerr.dev');
    const res = await (await admin())
      .post('/request')
      .send({ mediaType: 'movie', mediaId: 2, userId: kid.id });
    assert.equal(res.status, 403);
  });

  it('refuses reassigning a blocked request to a restricted user', async () => {
    const req = await seedRequest(2, 'admin@seerr.dev');
    await restrictUser('demo@seerr.dev', 10);
    const kid = await loadUser('demo@seerr.dev');
    const res = await (await admin())
      .put(`/request/${req.id}`)
      .send({ mediaType: 'movie', userId: kid.id });
    assert.equal(res.status, 403);
  });
});

describe('lists for a restricted user', () => {
  it('hides blocked requests and media', async () => {
    await seedRequest(1, 'demo@seerr.dev');
    await seedRequest(2, 'demo@seerr.dev');
    await restrictUser('demo@seerr.dev', 10);
    const kid = await loadUser('demo@seerr.dev');
    const agent = await demo();
    const lists: Record<string, unknown> = {};
    for (const path of ['/request', '/media', `/user/${kid.id}/requests`]) {
      const { results } = (await agent.get(path)).body;
      lists[path] = results.map(
        (r: { media?: { tmdbId: number }; tmdbId?: number }) =>
          r.media?.tmdbId ?? r.tmdbId
      );
    }
    assert.deepEqual(lists, {
      '/request': [1],
      '/media': [1],
      [`/user/${kid.id}/requests`]: [1],
    });
  });

  it("hides blocked titles from the user's watchlist", async () => {
    await restrictUser('demo@seerr.dev', 10);
    // Seeded users are Plex users; without a token the local watchlist is read
    await getRepository(User).update(
      { email: 'demo@seerr.dev' },
      { plexToken: null }
    );
    const kid = await loadUser('demo@seerr.dev');
    for (const tmdbId of [1, 2]) {
      await getRepository(Watchlist).save(
        new Watchlist({
          tmdbId,
          mediaType: MediaType.MOVIE,
          title: `t${tmdbId}`,
          ratingKey: '',
          requestedBy: kid,
          media: await saveMedia(tmdbId),
        })
      );
    }
    const res = await (await demo()).get(`/user/${kid.id}/watchlist`);
    assert.deepEqual(
      res.body.results.map((r: { tmdbId: number }) => r.tmdbId),
      [1]
    );
  });

  it('hides blocked titles from recently watched', async () => {
    getSettings().tautulli = {
      hostname: 'localhost',
      port: 8181,
      apiKey: 'k',
    } as TautulliSettings;
    mock.method(TautulliAPI.prototype, 'getUserWatchStats', async () => ({
      total_plays: 2,
    }));
    mock.method(TautulliAPI.prototype, 'getUserWatchHistory', async () => [
      { media_type: 'movie', rating_key: 'k1' },
      { media_type: 'movie', rating_key: 'k2' },
    ]);
    await saveMedia(1, { ratingKey: 'k1' });
    await saveMedia(2, { ratingKey: 'k2' });
    await restrictUser('demo@seerr.dev', 10);
    const kid = await loadUser('demo@seerr.dev');
    const res = await (await demo()).get(`/user/${kid.id}/watch_data`);
    getSettings().tautulli = {} as TautulliSettings;
    assert.deepEqual(
      res.body.recentlyWatched.map((m: { tmdbId: number }) => m.tmdbId),
      [1]
    );
  });

  it('hides blocked titles from the blocklist', async () => {
    const parent = await loadUser('admin@seerr.dev');
    for (const tmdbId of [1, 2]) {
      await getRepository(Blocklist).save(
        new Blocklist({
          mediaType: MediaType.MOVIE,
          tmdbId,
          title: `t${tmdbId}`,
          user: parent,
          media: await saveMedia(tmdbId, { status: MediaStatus.BLOCKLISTED }),
        })
      );
    }
    await restrictUser('demo@seerr.dev', 10);
    await getRepository(User).update(
      { email: 'demo@seerr.dev' },
      { permissions: Permission.REQUEST | Permission.VIEW_BLOCKLIST }
    );
    const res = await (await demo()).get('/blocklist');
    assert.deepEqual(
      res.body.results.map((b: { tmdbId: number }) => b.tmdbId),
      [1]
    );
  });
});

describe('watchlist', () => {
  it('refuses to add a blocked title', async () => {
    await restrictUser('demo@seerr.dev', 10);
    const res = await (await demo())
      .post('/watchlist')
      .send({ mediaType: 'movie', tmdbId: 2, title: 'no' });
    assert.equal(res.status, 403);
    assert.equal(await getRepository(Watchlist).count(), 0);
  });
});
