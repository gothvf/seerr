import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import {
  ParentalRestrictionError,
  assertTitleAllowed,
  filterMedia,
  filterTitles,
  isTitleAllowed,
  parentalPage,
} from '@server/lib/parental';
import { setupTestDb } from '@server/test/db';
import {
  ALLOWED,
  BLOCKED_18,
  failingTitles,
  fakeRatings,
  loadUser,
  resetParental,
  restrictUser,
} from '@server/test/parental';

setupTestDb();
beforeEach(resetParental);

const kid = async () => {
  await restrictUser('demo@seerr.dev', 10);
  return loadUser('demo@seerr.dev');
};

// Source page p holds ids p*100 .. p*100+19; allowedEvery=2 allows every other one.
function source(totalPages: number, allowedEvery: number) {
  const requested: number[] = [];
  const fetchPage = async (p: number) => {
    requested.push(p);
    const results = Array.from({ length: 20 }, (_, i) => {
      const id = p * 100 + i;
      fakeRatings.set(
        `movie:${id}`,
        i % allowedEvery === 0 ? ALLOWED : BLOCKED_18
      );
      return { id, media_type: 'movie' };
    });
    return {
      page: p,
      total_pages: totalPages,
      total_results: totalPages * 20,
      results,
    };
  };
  return { fetchPage, requested };
}

describe('isTitleAllowed', () => {
  it('allows everything for a user without a profile, without a lookup', async () => {
    const parent = await loadUser('admin@seerr.dev');
    failingTitles.add('movie:1');
    assert.equal(await isTitleAllowed(parent, MediaType.MOVIE, 1), true);
  });

  it('applies the profile age', async () => {
    const user = await kid();
    fakeRatings.set('movie:1', ALLOWED);
    fakeRatings.set('movie:2', BLOCKED_18);
    assert.equal(await isTitleAllowed(user, MediaType.MOVIE, 1), true);
    assert.equal(await isTitleAllowed(user, MediaType.MOVIE, 2), false);
  });

  it('fails closed when the lookup fails', async () => {
    const user = await kid();
    failingTitles.add('movie:3');
    assert.equal(await isTitleAllowed(user, MediaType.MOVIE, 3), false);
  });

  it('hides adult titles', async () => {
    const user = await kid();
    fakeRatings.set('movie:4', ALLOWED);
    assert.equal(await isTitleAllowed(user, MediaType.MOVIE, 4, true), false);
  });
});

describe('assertTitleAllowed', () => {
  it('throws ParentalRestrictionError for a blocked title', async () => {
    const user = await kid();
    fakeRatings.set('tv:5', { FR: ['16'] });
    await assert.rejects(
      assertTitleAllowed(user, MediaType.TV, 5),
      ParentalRestrictionError
    );
  });
});

describe('filterTitles', () => {
  it('keeps allowed titles, collections and people, drops unknown kinds', async () => {
    const user = await kid();
    fakeRatings.set('movie:1', ALLOWED);
    fakeRatings.set('movie:2', BLOCKED_18);
    fakeRatings.set('tv:3', ALLOWED);
    const items = [
      { id: 1, media_type: 'movie' },
      { id: 2, media_type: 'movie' },
      { id: 3, media_type: 'tv' },
      { id: 9, media_type: 'collection' },
      { id: 7 },
    ];
    const kept = await filterTitles(user, items);
    assert.deepEqual(
      kept.map((i) => i.id),
      [1, 3, 9]
    );
  });

  it('filters a person known_for', async () => {
    const user = await kid();
    fakeRatings.set('movie:1', ALLOWED);
    fakeRatings.set('movie:2', BLOCKED_18);
    const person = {
      id: 50,
      media_type: 'person',
      known_for: [
        { id: 1, media_type: 'movie' },
        { id: 2, media_type: 'movie' },
      ],
    };
    const [kept] = await filterTitles(user, [person]);
    assert.deepEqual(
      kept.known_for.map((i) => i.id),
      [1]
    );
  });

  it('uses the fallback type for items without media_type', async () => {
    const user = await kid();
    fakeRatings.set('tv:3', ALLOWED);
    assert.deepEqual(
      (await filterTitles(user, [{ id: 3 }], MediaType.TV)).map((i) => i.id),
      [3]
    );
  });

  it('returns the same array for a user without a profile', async () => {
    const parent = await loadUser('admin@seerr.dev');
    const items = [{ id: 7 }];
    assert.equal(await filterTitles(parent, items), items);
  });
});

describe('filterMedia', () => {
  it('filters DB rows by their TMDB id', async () => {
    const user = await kid();
    fakeRatings.set('movie:1', ALLOWED);
    fakeRatings.set('movie:2', BLOCKED_18);
    const rows = [
      { tmdbId: 1, mediaType: MediaType.MOVIE },
      { tmdbId: 2, mediaType: MediaType.MOVIE },
    ];
    const kept = await filterMedia(user, rows, (r) => r);
    assert.deepEqual(
      kept.map((r) => r.tmdbId),
      [1]
    );
  });
});

describe('parentalPage', () => {
  it('passes the page through for a user without a profile', async () => {
    const parent = await loadUser('admin@seerr.dev');
    const { fetchPage, requested } = source(10, 2);
    const data = await parentalPage(parent, 3, fetchPage);
    assert.deepEqual(requested, [3]);
    assert.equal(data.results.length, 20);
    assert.equal(data.total_pages, 10);
  });

  it('reads two source pages per page and stops when full', async () => {
    const user = await kid();
    const { fetchPage, requested } = source(10, 2);
    const data = await parentalPage(user, 1, fetchPage);
    assert.deepEqual(requested, [1, 2]);
    assert.equal(data.results.length, 20);
    assert.equal(data.page, 1);
    assert.equal(data.total_pages, 5);
  });

  it('starts page 2 at source page 3', async () => {
    const user = await kid();
    const { fetchPage, requested } = source(10, 2);
    await parentalPage(user, 2, fetchPage);
    assert.deepEqual(requested, [3, 4]);
  });

  it('reads ahead at most five pages on a sparse source', async () => {
    const user = await kid();
    const { fetchPage, requested } = source(50, 20);
    const data = await parentalPage(user, 1, fetchPage);
    assert.deepEqual(requested, [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(data.results.length, 7);
  });

  it("stops at the source's last page", async () => {
    const user = await kid();
    const { fetchPage, requested } = source(3, 20);
    await parentalPage(user, 1, fetchPage);
    assert.deepEqual(requested, [1, 2, 3]);
  });

  it('never reads past page 500', async () => {
    const user = await kid();
    const { fetchPage, requested } = source(40000, 20);
    const data = await parentalPage(user, 250, fetchPage);
    assert.deepEqual(requested, [499, 500]);
    assert.equal(data.total_pages, 250);
  });

  it('drops a title repeated across source pages', async () => {
    const user = await kid();
    fakeRatings.set('movie:1', ALLOWED);
    const fetchPage = async (p: number) => ({
      page: p,
      total_pages: 2,
      total_results: 2,
      results: [{ id: 1, media_type: 'movie' }],
    });
    const data = await parentalPage(user, 1, fetchPage);
    assert.equal(data.results.length, 1);
  });

  it('treats a missing or invalid page as page 1', async () => {
    const user = await kid();
    const { fetchPage, requested } = source(10, 2);
    await parentalPage(user, Number(undefined), fetchPage);
    assert.deepEqual(requested, [1, 2]);
  });
});
