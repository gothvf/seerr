import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

// Every GET route under server/routes, by file. "filtered" means its titles pass
// through server/lib/parental for users with a parental profile; anything else is
// the reason it returns no titles to them. A whole file can be listed at once.
// A new, renamed or removed route fails this test until it is classified here.
const FILTERED = 'filtered';
const CLASSIFIED: Record<string, string> = {
  'auth.ts': 'none: sign-in and the current user',
  'avatarproxy.ts': 'none: avatar images',
  'blocklist.ts GET /': FILTERED,
  'blocklist.ts GET /:id': 'none: one blocklist entry, Manage Blocklist only',
  'collection.ts GET /:id': FILTERED,
  'discover.ts': FILTERED,
  'imageproxy.ts': 'none: images by path',
  'index.ts GET /status': 'none: server status',
  'index.ts GET /status/appdata': 'none: server status',
  'index.ts GET /settings/public': 'none: public settings',
  'index.ts GET /settings/discover': 'none: slider configuration',
  'index.ts GET /settings/notifications/pushover/sounds': 'none: sounds',
  'index.ts GET /regions': 'none: region list',
  'index.ts GET /languages': 'none: language list',
  'index.ts GET /studio/:id': 'none: company details',
  'index.ts GET /network/:id': 'none: network details',
  'index.ts GET /genres/movie': 'none: genre list',
  'index.ts GET /genres/tv': 'none: genre list',
  'index.ts GET /backdrops':
    'none for signed-in users: login page backdrops, no user (known gap in the spec)',
  'index.ts GET /keyword/:keywordId': 'none: keyword details',
  'index.ts GET /watchproviders/regions': 'none: provider list',
  'index.ts GET /watchproviders/movies': 'none: provider list',
  'index.ts GET /watchproviders/tv': 'none: provider list',
  'index.ts GET /certifications/movie': 'none: certification lists',
  'index.ts GET /certifications/tv': 'none: certification lists',
  'index.ts GET /': 'none: API root',
  'issue.ts':
    'none: issues name titles by TMDB id only; clients load them through the guarded detail routes',
  'issueComment.ts': 'none: comments',
  'media.ts GET /': FILTERED,
  'media.ts GET /:id/watch_data': 'none: play statistics for one media row',
  'movie.ts': FILTERED,
  'overrideRule.ts': 'none: admin rules',
  'parentalProfile.ts': 'none: profile management',
  'person.ts GET /:id': 'none: person details',
  'person.ts GET /:id/combined_credits': FILTERED,
  'request.ts GET /': FILTERED,
  'request.ts GET /count': 'none: counts',
  'request.ts GET /:requestId':
    'none: one request, title by TMDB id only (detail routes are guarded)',
  'search.ts GET /': FILTERED,
  'search.ts GET /keyword': 'none: keywords',
  'search.ts GET /company': 'none: companies',
  'service.ts GET /radarr': 'none: server settings',
  'service.ts GET /radarr/:radarrId': 'none: server settings',
  'service.ts GET /sonarr': 'none: server settings',
  'service.ts GET /sonarr/:sonarrId': 'none: server settings',
  'service.ts GET /sonarr/lookup/:tmdbId': FILTERED,
  'settings/discover.ts': 'none: admin settings',
  'settings/index.ts': 'none: admin settings',
  'settings/metadata.ts': 'none: admin settings',
  'settings/notifications.ts': 'none: admin settings',
  'settings/radarr.ts': 'none: admin settings',
  'settings/sonarr.ts': 'none: admin settings',
  'tv.ts': FILTERED,
  'user/index.ts GET /': 'none: user list',
  'user/index.ts GET /:id/pushSubscriptions': 'none: push subscriptions',
  'user/index.ts GET /:id/pushSubscription/:endpoint':
    'none: push subscriptions',
  'user/index.ts GET /:id': 'none: user details',
  'user/index.ts GET /jellyfin/:jellyfinUserId': 'none: user lookup',
  'user/index.ts GET /:id/requests': FILTERED,
  'user/index.ts GET /:id/quota': 'none: quotas',
  'user/index.ts GET /:id/watch_data': FILTERED,
  'user/index.ts GET /:id/watchlist': FILTERED,
  'user/usersettings.ts': 'none: user settings',
  'watchlist.ts':
    'none: no GET routes (adds are refused in Watchlist.createWatchlist)',
};

const ROUTES_DIR = __dirname;

function routeFiles(dir = ROUTES_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [relative(ROUTES_DIR, path)]
      : [];
  });
}

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

function getRoutes(file: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const router = require(join(ROUTES_DIR, file)).default as { stack?: Layer[] };
  return (router?.stack ?? [])
    .filter((layer) => layer.route?.methods.get)
    .map((layer) => `${file} GET ${layer.route!.path}`);
}

describe('parental route coverage', () => {
  const files = routeFiles();
  const routes = files.flatMap(getRoutes);

  it('classifies every GET route', () => {
    const missing = routes.filter(
      (route) => !(route in CLASSIFIED) && !(route.split(' ')[0] in CLASSIFIED)
    );
    assert.deepEqual(
      missing,
      [],
      'classify these routes in parentalCoverage.test.ts'
    );
  });

  it('lists no route or file that no longer exists', () => {
    const stale = Object.keys(CLASSIFIED).filter((key) =>
      key.includes(' ') ? !routes.includes(key) : !files.includes(key)
    );
    assert.deepEqual(stale, []);
  });
});
