// Deep offset scans grow with page depth. Keep offset pagination bounded while
// the UI uses numbered pages; cursor pagination is the next step for larger sets.
const MAX_OFFSET = 100_000;

const parsePagination = (query, { defaultLimit = 20, maxLimit = 50 } = {}) => {
  const pageValue = query.page === undefined ? "1" : query.page;
  const limitValue = query.limit === undefined ? String(defaultLimit) : query.limit;
  if (typeof pageValue !== "string" || !/^[1-9]\d*$/.test(pageValue)
    || typeof limitValue !== "string" || !/^[1-9]\d*$/.test(limitValue)) {
    return { error: "Page and limit must be positive whole numbers." };
  }
  const page = Number(pageValue);
  const limit = Number(limitValue);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > maxLimit
    || !Number.isSafeInteger(offset) || offset > MAX_OFFSET) {
    return { error: `Limit must be between 1 and ${maxLimit}, and the page offset cannot exceed ${MAX_OFFSET}.` };
  }
  return { page, limit, offset };
};

module.exports = { parsePagination };
