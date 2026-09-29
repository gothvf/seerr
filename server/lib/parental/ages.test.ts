import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import type { ParentalRule, TitleRatings } from '@server/lib/parental/ages';
import {
  BLOCKED,
  SUPPORTED_COUNTRIES,
  ageFor,
  isRatingAllowed,
} from '@server/lib/parental/ages';

const kids10: ParentalRule = { maxAge: 10, allowUnrated: false };
const countries = ['FR', 'GB', 'DE', 'US'];

const check = (
  ratings: TitleRatings,
  rule = kids10,
  adult = false,
  mediaType = MediaType.MOVIE
) => isRatingAllowed({ mediaType, ratings, adult }, countries, rule);

describe('ageFor', () => {
  it('maps official ratings to ages', () => {
    assert.equal(ageFor('FR', MediaType.MOVIE, '12'), 12);
    assert.equal(ageFor('GB', MediaType.MOVIE, '12A'), 12);
    assert.equal(ageFor('GB', MediaType.MOVIE, 'PG'), 8);
    assert.equal(ageFor('US', MediaType.TV, 'TV-MA'), 17);
    assert.equal(ageFor('FR', MediaType.TV, '10'), 10);
    assert.equal(ageFor('ES', MediaType.MOVIE, '7'), 7);
    assert.equal(ageFor('US', MediaType.MOVIE, 'NC-17'), 18);
    assert.equal(ageFor('AU', MediaType.MOVIE, 'PG'), 15);
  });

  it('marks adult-only ratings as blocked', () => {
    for (const [country, rating] of [
      ['GB', 'R18'],
      ['CA', 'A'],
      ['ES', 'X'],
      ['AU', 'X 18+'],
      ['AU', 'RC'],
    ]) {
      assert.equal(ageFor(country, MediaType.MOVIE, rating), BLOCKED);
    }
  });

  it('has no age for NR, exempt, BA and unknown strings or countries', () => {
    assert.equal(ageFor('US', MediaType.MOVIE, 'NR'), undefined);
    assert.equal(ageFor('CA', MediaType.MOVIE, 'E'), undefined);
    assert.equal(ageFor('CA', MediaType.TV, 'Exempt'), undefined);
    assert.equal(ageFor('IT', MediaType.TV, 'BA'), undefined);
    assert.equal(ageFor('FR', MediaType.MOVIE, '10'), undefined);
    assert.equal(ageFor('XX', MediaType.MOVIE, '12'), undefined);
  });

  it('trims TMDB strings', () => {
    assert.equal(ageFor('FR', MediaType.MOVIE, ' 16 '), 16);
  });

  it('supports the ten countries of the spec', () => {
    assert.deepEqual([...SUPPORTED_COUNTRIES].sort(), [
      'AU',
      'BR',
      'CA',
      'DE',
      'ES',
      'FR',
      'GB',
      'IT',
      'NL',
      'US',
    ]);
  });
});

describe('isRatingAllowed', () => {
  it('uses the first listed country that has a known rating', () => {
    assert.equal(check({ FR: ['TP'], US: ['PG-13'] }), true);
    assert.equal(check({ DE: ['12'], US: ['G'] }), false);
  });

  it('skips a country whose ratings are all unknown', () => {
    assert.equal(check({ FR: ['NR'], GB: ['PG'] }), true);
  });

  it('takes the highest of several ratings in one country', () => {
    assert.equal(check({ FR: ['TP', '12'] }), false);
  });

  it('ignores countries that are not in the list', () => {
    assert.equal(check({ NL: ['6'] }), false);
  });

  it('lets allowUnrated decide for unrated titles', () => {
    assert.equal(check({}), false);
    assert.equal(check({}, { maxAge: 10, allowUnrated: true }), true);
  });

  it('allows a title at exactly the max age', () => {
    assert.equal(check({ FR: ['10'] }, kids10, false, MediaType.TV), true);
  });

  it('hides adult titles and blocked ratings from any country', () => {
    const adultOk: ParentalRule = { maxAge: 18, allowUnrated: true };
    assert.equal(check({ FR: ['TP'] }, adultOk, true), false);
    assert.equal(check({ FR: ['18'], GB: ['R18'] }, adultOk), false);
    assert.equal(check({ AU: ['RC'] }, adultOk), false);
  });

  it('reads the TV tables for series', () => {
    assert.equal(
      check(
        { US: ['TV-Y7'] },
        { maxAge: 7, allowUnrated: false },
        false,
        MediaType.TV
      ),
      true
    );
  });
});
