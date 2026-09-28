import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieDetails,
  TmdbMovieReleaseResult,
  TmdbTvDetails,
  TmdbTvRatingResult,
} from '@server/api/themoviedb/interfaces';
import { getRepository } from '@server/datasource';
import ParentalProfile from '@server/entity/ParentalProfile';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import cacheManager from '@server/lib/cache';
import type { TitleRatings } from '@server/lib/parental/ages';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

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

/** An app with sessions, checkUser, /auth and the error handler around the given routes. */
export function createTestApp(mount: (app: Express) => void): Express {
  const app = express();
  app.use(express.json());
  app.use(
    session({ secret: 'test-secret', resave: false, saveUninitialized: false })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  mount(app);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

/** Signs in with the seeded password; returns an agent that keeps the session. */
export async function loginAs(app: Express, email: string) {
  const settings = getSettings();
  const prior = settings.main.localLogin;
  settings.main.localLogin = true;
  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email, password: 'test1234' });
    if (res.status !== 200) {
      throw new Error(`login as ${email} failed: ${res.status}`);
    }
    return agent;
  } finally {
    settings.main.localLogin = prior;
  }
}

// Every field mapMovieDetails / mapTvDetails reads, empty
export const fakeMovieDetails = (id: number): TmdbMovieDetails =>
  ({
    id,
    adult: false,
    title: `Movie ${id}`,
    original_title: `Movie ${id}`,
    overview: 'Overview',
    genres: [],
    credits: { cast: [], crew: [] },
    videos: { results: [] },
    release_dates: { results: [] },
    keywords: { keywords: [] },
    production_companies: [],
    production_countries: [],
    spoken_languages: [],
    external_ids: {},
    original_language: 'en',
  }) as unknown as TmdbMovieDetails;

export const fakeTvDetails = (id: number): TmdbTvDetails =>
  ({
    id,
    name: `Show ${id}`,
    original_name: `Show ${id}`,
    overview: 'Overview',
    aggregate_credits: { cast: [] },
    credits: { crew: [] },
    content_ratings: { results: [] },
    created_by: [],
    episode_run_time: [],
    genres: [],
    keywords: { results: [] },
    languages: [],
    networks: [],
    origin_country: [],
    production_companies: [],
    production_countries: [],
    seasons: [],
    spoken_languages: [],
    videos: { results: [] },
    external_ids: {},
    original_language: 'en',
  }) as unknown as TmdbTvDetails;
