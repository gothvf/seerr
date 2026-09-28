import { MediaType } from '@server/constants/media';

/** A rating no parental profile may see, whatever its max age. */
export const BLOCKED = 'blocked';
export type Age = number | typeof BLOCKED;

type AgeTable = Record<string, Age>;

// Minimum age for each TMDB certification string, from each country's rating body
// (checked 2026-09-28; where Jellyfin's rating files differ, the official age wins).
// A string missing from a table gives no age: resolution moves to the next country.
export const AGE_TABLES: Record<string, { movie: AgeTable; tv: AgeTable }> = {
  // https://www.filmratings.com/ratings-guide/ and https://www.tvguidelines.org/
  US: {
    movie: { G: 0, PG: 10, 'PG-13': 13, R: 17, 'NC-17': 18 },
    tv: {
      'TV-Y': 0,
      'TV-G': 0,
      'TV-Y7': 7,
      'TV-PG': 10,
      'TV-14': 14,
      'TV-MA': 17,
    },
  },
  // https://www.consumerprotectionbc.ca/motion-picture-ratings/what-ratings-mean/
  // and https://www.cbsc.ca/codes/cab-violence-code/
  CA: {
    movie: { G: 0, PG: 8, '14A': 14, '18A': 18, R: 18, A: BLOCKED },
    tv: { C: 0, G: 0, C8: 8, PG: 8, '14+': 14, '18+': 18 },
  },
  // https://www.bbfc.co.uk/about-classification
  GB: {
    movie: {
      U: 0,
      PG: 8,
      '12A': 12,
      '12': 12,
      '15': 15,
      '18': 18,
      R18: BLOCKED,
    },
    tv: {
      U: 0,
      PG: 8,
      '12A': 12,
      '12': 12,
      '15': 15,
      '18': 18,
      R18: BLOCKED,
    },
  },
  // Code du cinema art. R211-12 (legifrance.gouv.fr) and https://www.arcom.fr/
  FR: {
    movie: { TP: 0, '12': 12, '16': 16, '18': 18 },
    tv: { TP: 0, '10': 10, '12': 12, '16': 16, '18': 18 },
  },
  // https://www.fsk.de/altersstufen/ and https://fsf.de/
  DE: {
    movie: { '0': 0, '6': 6, '12': 12, '16': 16, '18': 18 },
    tv: { '0': 0, '6': 6, '12': 12, '16': 16, '18': 18 },
  },
  // RD 1084/2015 and LGCA (boe.es), https://www.cnmc.es/
  ES: {
    movie: {
      A: 0,
      Ai: 0,
      '7': 7,
      '7i': 7,
      '12': 12,
      '16': 16,
      '18': 18,
      X: BLOCKED,
    },
    tv: {
      ERI: 0,
      TP: 0,
      '7': 7,
      '10': 10,
      '12': 12,
      '13': 13,
      '16': 16,
      '18': 18,
    },
  },
  // https://cinema.cultura.gov.it/ (DLgs 203/2017) and AGCOM/TUSMAR
  IT: {
    movie: { T: 0, '6+': 6, '10+': 10, '14+': 14, '18+': 18 },
    tv: { T: 0, VM12: 12, VM14: 14, VM18: 18 },
  },
  // https://www.kijkwijzer.nl/ and https://nicam.nl/
  NL: {
    movie: { AL: 0, '6': 6, '9': 9, '12': 12, '14': 14, '16': 16, '18': 18 },
    tv: { AL: 0, '6': 6, '9': 9, '12': 12, '14': 14, '16': 16, '18': 18 },
  },
  // https://www.classification.gov.au/classification-ratings/what-are-ratings
  AU: {
    movie: {
      G: 0,
      PG: 15,
      M: 15,
      'MA 15+': 15,
      'R 18+': 18,
      'X 18+': BLOCKED,
      RC: BLOCKED,
    },
    tv: { P: 0, C: 0, G: 0, PG: 15, M: 15, 'MA 15+': 15, 'R 18+': 18 },
  },
  // https://www.gov.br/mj/pt-br/assuntos/seus-direitos/classificacao-1
  BR: {
    movie: { L: 0, '10': 10, '12': 12, '14': 14, '16': 16, '18': 18 },
    tv: { L: 0, '10': 10, '12': 12, '14': 14, '16': 16, '18': 18 },
  },
};

export const SUPPORTED_COUNTRIES = Object.keys(AGE_TABLES);

export const ageFor = (
  country: string,
  mediaType: MediaType,
  certification: string
): Age | undefined =>
  AGE_TABLES[country]?.[mediaType === MediaType.MOVIE ? 'movie' : 'tv'][
    certification.trim()
  ];

/** Certifications per country (ISO 3166-1), as TMDB lists them for one title. */
export type TitleRatings = Record<string, string[]>;

export interface ParentalRule {
  maxAge: number;
  allowUnrated: boolean;
}

export const isRatingAllowed = (
  title: { mediaType: MediaType; ratings: TitleRatings; adult?: boolean },
  countries: string[],
  rule: ParentalRule
): boolean => {
  const agesIn = (country: string): (Age | undefined)[] =>
    (title.ratings[country] ?? []).map((c) =>
      ageFor(country, title.mediaType, c)
    );

  if (
    title.adult ||
    Object.keys(title.ratings).some((c) => agesIn(c).includes(BLOCKED))
  ) {
    return false;
  }

  for (const country of countries) {
    const ages = agesIn(country).filter(
      (a): a is number => typeof a === 'number'
    );
    if (ages.length > 0) {
      return Math.max(...ages) <= rule.maxAge;
    }
  }

  return rule.allowUnrated;
};
