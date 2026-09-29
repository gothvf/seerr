> [!NOTE]
> **This is a fork: [gothvf/seerr](https://github.com/gothvf/seerr), branch `feat/parental-profiles`.** It adds per-user parental profiles to Seerr 3.5.0. Everything below the fork notes is the upstream README. See [About this fork](#about-this-fork).

## About this fork

### What it adds

An admin creates **parental profiles** (a name, a maximum age from 0 to 18, and whether unrated titles show) and assigns one to a user. A user with a profile never sees or requests a title above its age, anywhere in the Seerr API: Discover, Trending, search, recommendations, people, collections, title pages, requests, watchlists. Filtering runs on the server, so every client gets it (the web UI, and apps that proxy Seerr, such as Moonfin through the Moonbase plugin). Users without a profile see exactly what upstream shows.

A title's age comes from TMDB certifications:

- The admin sets an ordered **country list** (default `US`). The first listed country that rates the title decides; within that country the highest age wins. Other countries are ignored.
- Each supported country (US, CA, GB, FR, DE, ES, IT, NL, AU, BR) has a table mapping its certifications to the age its rating body sets. Sources are in [`server/lib/parental/ages.ts`](server/lib/parental/ages.ts).
- Titles TMDB marks adult, and adult-only ratings in any country (UK R18, Australian RC or X 18+, Canadian A, Spanish X), are hidden from every profile.
- A title no listed country rates is unrated: hidden unless the profile allows unrated titles.
- If the rating lookup fails, the title is hidden (fail closed).

Opening a blocked title (its page, seasons, ratings, Sonarr lookup), requesting it, adding it to a watchlist, or reassigning its request to a restricted user answers 403 "This title is not available." So does a title whose rating lookup failed.

### Where the code is

| Part | Files |
| --- | --- |
| Age tables and the resolution rule | `server/lib/parental/ages.ts` |
| TMDB certification lookup, 24 h cache (`parental`, shown as "Parental Controls Ratings" in Jobs & Cache) | `server/lib/parental/ratings.ts`, `server/lib/cache.ts`, `getMovieReleaseDates` / `getTvContentRatings` in `server/api/themoviedb/index.ts` |
| The filter every route calls: `isTitleAllowed`, `assertTitleAllowed`, `filterTitles`, `filterMedia`, `parentalPage` | `server/lib/parental/index.ts` |
| Profile entity, link from `UserSettings` (`onDelete: RESTRICT`), migrations | `server/entity/ParentalProfile.ts`, `server/entity/UserSettings.ts`, `server/migration/{sqlite,postgres}/*-AddParentalProfiles.ts` |
| Country list setting (`parental.countries`) | `server/lib/settings/index.ts` |
| API: profiles, countries, assigning a profile | `server/routes/parentalProfile.ts`, `server/routes/settings/index.ts` (`/settings/parental`), `server/routes/user/usersettings.ts` (`parentalProfileId`), `seerr-api.yml` |
| Filtered routes | `discover.ts`, `search.ts`, `movie.ts`, `tv.ts`, `person.ts`, `collection.ts`, `service.ts` (Sonarr lookup), `request.ts`, `media.ts`, `blocklist.ts`, `user/index.ts`, all in `server/routes/` |
| Refused actions | `server/entity/MediaRequest.ts`, `server/entity/Watchlist.ts`, `server/routes/request.ts` (reassign), `server/lib/watchlistsync.ts` |
| Web UI: Settings, Parental Controls; the profile dropdown in a user's General settings | `src/components/Settings/SettingsParental/`, `src/pages/settings/parental.tsx`, `src/components/UserProfile/UserSettings/UserGeneralSettings/index.tsx` |
| Web UI paging (a short page is not the end of the list) | `src/utils/discoverPaging.ts`, `src/hooks/useDiscover.ts` |
| User docs | `docs/using-seerr/settings/parental-controls.md` |
| Fork image build | `.github/workflows/build-image.yml` |

Creating, editing and deleting profiles, and setting the country list, need Admin. Listing profiles and assigning them need Manage Users. Nobody sees or changes their own profile: `parentalProfileId` is returned and accepted only for a user with Manage Users editing someone else.

### Paging for restricted users

TMDB returns 20 titles a page, and a profile can hide most of them. For a restricted user, Seerr page N reads TMDB pages 2N-1 and 2N, then up to 5 more while it has fewer than 20 titles, and reports half of TMDB's page count (TMDB serves 500 pages at most). Unrestricted users get TMDB's page untouched, with one TMDB call. The first uncached restricted page takes a few seconds; the ratings cache makes later ones fast.

### Tests

`pnpm test` (Node 22) runs upstream's suite plus:

- `server/lib/parental/*.test.ts`: age tables, resolution, cache, filter, paging.
- `server/entity/ParentalProfile.test.ts`: entity and delete restriction.
- `server/routes/parentalProfile.test.ts`, `discover.parental.test.ts`, `titles.parental.test.ts`, `request.parental.test.ts`: the API as a restricted and an unrestricted user.
- `server/routes/parentalCoverage.test.ts`: lists every GET route and fails when one is not marked as filtered or as returning no titles. Add any new GET route there.
- `src/utils/discoverPaging.test.ts`.

The route tests run without Seerr's OpenAPI request validator, which answers 404 for paths missing from `seerr-api.yml`. Add new routes to the spec too.

### Known limits

- Ages follow TMDB's data. Some countries rate leniently (TMDB lists Oppenheimer as "TP", all ages, in France), so the country order matters.
- Restricted pages often hold fewer than 20 titles, and consecutive pages can repeat a title (the web UI drops repeats).
- The sign-in page backdrops are not filtered (that route has no user).
- Request counts include hidden titles (a restricted user sees numbers, not titles).
- Rebasing: an upstream SQLite migration that rebuilds `user_settings` would drop `parentalProfileId`. Seerr then fails loudly on every user load; add a fork migration after upstream's.

### Diff with upstream

- On GitHub: [seerr-team/seerr v3.5.0...gothvf:feat/parental-profiles](https://github.com/seerr-team/seerr/compare/v3.5.0...gothvf:seerr:feat/parental-profiles).
- Locally: `git remote add upstream https://github.com/seerr-team/seerr.git && git fetch upstream --tags && git diff v3.5.0...feat/parental-profiles`.

`develop` in this fork is a plain copy of upstream. Images are `ghcr.io/gothvf/seerr:parental-<upstream version>-<n>`, built by `build-image.yml` on `parental-*` tags. Never push a `v*` tag here: upstream's release workflow runs on those.

### Upstream status and how this was written

This fork is not proposed upstream. The upstream effort for the same feature is [seerr-team/seerr#2415](https://github.com/seerr-team/seerr/pull/2415) (requests: [#501](https://github.com/seerr-team/seerr/issues/501), [#354](https://github.com/seerr-team/seerr/issues/354)). The code here was written with Claude Code, driven by an AI agent and checked by the tests above and by use on a family server. Seerr's [contributing guide](CONTRIBUTING.md) does not accept AI-driven pull requests, so anyone bringing this upstream should treat it as a reference and write their contribution themselves.

---

<p align="center">
<img src="./public/logo_full.svg" alt="Seerr" style="margin: 20px 0;">
</p>
<p align="center">
<img src="https://github.com/seerr-team/seerr/actions/workflows/release.yml/badge.svg" alt="Seerr Release" />
<img src="https://github.com/seerr-team/seerr/actions/workflows/ci.yml/badge.svg" alt="Seerr CI">
</p>
<p align="center">
<a href="https://discord.gg/seerr"><img src="https://img.shields.io/discord/783137440809746482" alt="Discord"></a>
<a href="https://hub.docker.com/r/seerr/seerr"><img src="https://img.shields.io/docker/pulls/seerr/seerr" alt="Docker pulls"></a>
<a href="https://translate.seerr.dev/engage/seerr/"><img src="https://translate.seerr.dev/widget/seerr/svg-badge.svg" alt="Translation status" /></a>
<a href="https://github.com/seerr-team/seerr/blob/develop/LICENSE"><img alt="GitHub" src="https://img.shields.io/github/license/seerr-team/seerr"></a>

**Seerr** is a free and open source software application for managing requests for your media library. It integrates with the media server of your choice: [Jellyfin](https://jellyfin.org), [Plex](https://plex.tv), and [Emby](https://emby.media/). In addition, it integrates with your existing services, such as **[Sonarr](https://sonarr.tv/)**, **[Radarr](https://radarr.video/)**.

## Current Features

- Full Jellyfin/Emby/Plex integration including authentication with user import & management.
- Support for **PostgreSQL** and **SQLite** databases.
- Supports Movies, Shows and Mixed Libraries.
- Ability to change email addresses for SMTP purposes.
- Easy integration with your existing services. Currently, Seerr supports Sonarr and Radarr. More to come!
- Jellyfin/Emby/Plex library scan, to keep track of the titles which are already available.
- Customizable request system, which allows users to request individual seasons or movies in a friendly, easy-to-use interface.
- Incredibly simple request management UI. Don't dig through the app to simply approve recent requests!
- Granular permission system.
- Support for various notification agents.
- Mobile-friendly design, for when you need to approve requests on the go!
- Support for watchlisting & blocklisting media.

With more features on the way! Check out our [issue tracker](/../../issues) to see the features which have already been requested.

## Getting Started

Check out our documentation for instructions on how to install and run Seerr:

https://docs.seerr.dev/getting-started/

## Preview

<img src="./public/preview.jpg" alt="Seerr application preview" />

## Migrating from Overseerr/Jellyseerr to Seerr

Read our [release announcement](https://docs.seerr.dev/blog/seerr-release) to learn what Seerr means for Jellyseerr and Overseerr users.

Please follow our [migration guide](https://docs.seerr.dev/migration-guide) for detailed instructions on migrating from Overseerr or Jellyseerr.

## Support

- Check out the [Seerr Documentation](https://docs.seerr.dev) before asking for help. Your question might already be in the docs!
- You can get support on [Discord](https://discord.gg/seerr).
- You can ask questions in the Help category of our [GitHub Discussions](/../../discussions).
- Bug reports and feature requests can be submitted via [GitHub Issues](/../../issues).

## API Documentation

You can access the API documentation from your local Seerr install at http://localhost:5055/api-docs

## Community

You can ask questions, share ideas, and more in [GitHub Discussions](/../../discussions).

If you would like to chat with other members of our growing community, [join the Seerr Discord server](https://discord.gg/seerr)!

Our [Code of Conduct](./CODE_OF_CONDUCT.md) applies to all Seerr community channels.

## Contributing

You can help improve Seerr too! Check out our [Contribution Guide](./CONTRIBUTING.md) to get started.

## Contributors ✨

[![Contributors](https://opencollective.com/seerr/contributors.svg?width=890)](https://opencollective.com/seerr/#backers)

[![Become a Backer](https://opencollective.com/seerr/backers.svg)](https://opencollective.com/seerr/#backers)
[![Become a Sponsor](https://opencollective.com/seerr/sponsors.svg)](https://opencollective.com/seerr/#sponsors)
