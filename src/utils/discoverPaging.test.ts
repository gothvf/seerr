import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isLastDiscoverPage } from './discoverPaging';

const page = (page: number, totalPages: number, count: number) => ({
  page,
  totalPages,
  results: Array.from({ length: count }, (_, id) => ({ id })),
});

describe('isLastDiscoverPage', () => {
  it('ends on a short last page', () => {
    assert.equal(isLastDiscoverPage(page(3, 3, 7)), true);
  });

  it('keeps going after a short page that is not the last', () => {
    // A parental profile hides titles, so its pages are often short
    assert.equal(isLastDiscoverPage(page(1, 250, 15)), false);
  });

  it('ends on an empty page', () => {
    assert.equal(isLastDiscoverPage(page(4, 250, 0)), true);
  });

  it('keeps going after a full page', () => {
    assert.equal(isLastDiscoverPage(page(2, 250, 20)), false);
  });
});
