const PAGE_SIZE = 20;

// A short page ends the list only when it is also the last one: a parental profile
// hides titles, so a restricted user's pages are often short with more to come.
export const isLastDiscoverPage = (data: {
  page: number;
  totalPages: number;
  results: unknown[];
}): boolean =>
  data.results.length === 0 ||
  (data.results.length < PAGE_SIZE && data.page >= data.totalPages);
