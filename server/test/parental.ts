import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieReleaseResult,
  TmdbTvRatingResult,
} from '@server/api/themoviedb/interfaces';
import { getRepository } from '@server/datasource';
import ParentalProfile from '@server/entity/ParentalProfile';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import cacheManager from '@server/lib/cache';
import type { TitleRatings } from '@server/lib/parental/ages';
import { getSettings } from '@server/lib/settings';

export const ALLOWED: TitleRatings = { FR: ['TP'] };
export const BLOCKED_18: TitleRatings = { FR: ['18'] };

/** Certifications per title, keyed `movie:<id>` or `tv:<id>`; missing means none. */
export const fakeRatings = new Map<string, TitleRatings>();
/** Titles whose lookup throws, keyed like fakeRatings. */
export const failingTitles = new Set<string>();

const lookup = (key: string): TitleRatings => {
  if (failingTitles.has(key)) {
    throw new Error('TMDB down');
  }
  return fakeRatings.get(key) ?? {};
};

Object.defineProperty(TheMovieDb.prototype, 'getMovieReleaseDates', {
  get() {
    return async ({ movieId }: { movieId: number }) =>
      ({
        results: Object.entries(lookup(`movie:${movieId}`)).map(
          ([iso_3166_1, certs]) => ({
            iso_3166_1,
            release_dates: certs.map((certification) => ({
              certification,
              release_date: '',
              type: 3,
            })),
          })
        ),
      }) as unknown as TmdbMovieReleaseResult;
  },
  set() {},
  configurable: true,
});

Object.defineProperty(TheMovieDb.prototype, 'getTvContentRatings', {
  get() {
    return async ({ tvId }: { tvId: number }) =>
      ({
        results: Object.entries(lookup(`tv:${tvId}`)).flatMap(
          ([iso_3166_1, ratings]) =>
            ratings.map((rating) => ({ iso_3166_1, rating }))
        ),
      }) as TmdbTvRatingResult;
  },
  set() {},
  configurable: true,
});

export function resetParental(): void {
  fakeRatings.clear();
  failingTitles.clear();
  cacheManager.getCache('parental').flush();
  getSettings().parental = { countries: ['FR', 'US'] };
}

export function loadUser(email: string): Promise<User> {
  return getRepository(User).findOneOrFail({ where: { email } });
}

export async function restrictUser(
  email: string,
  maxAge: number,
  allowUnrated = false
): Promise<ParentalProfile> {
  const profile = await getRepository(ParentalProfile).save(
    new ParentalProfile({
      name: `Age ${maxAge} ${email}`,
      maxAge,
      allowUnrated,
    })
  );
  const user = await loadUser(email);
  user.settings = user.settings ?? new UserSettings({ notificationTypes: {} });
  user.settings.parentalProfile = profile;
  await getRepository(User).save(user);
  return profile;
}
