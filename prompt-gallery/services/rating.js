// Star ratings, out of 10.
//
// Ratings used to be out of 5 and hundreds of saved generations still carry
// those values. They are never rewritten on disk: a metadata record without
// `ratingScale: 10` is a legacy 5-star rating and reads as double, so a 4/5
// shows as 8/10. Writing a rating stamps the scale, which is what makes the
// stored number unambiguous from then on.

export const RATING_MAX = 10;

// A good generation — the "Favorites" collection threshold.
export const FAVORITE_RATING = 8;

export function ratingOf(metadata) {
  const raw = Number(metadata?.rating) || 0;
  if (raw <= 0) return 0;
  const value = Number(metadata?.ratingScale) === RATING_MAX ? raw : raw * 2;
  return Math.min(RATING_MAX, Math.round(value));
}

export function withRating(metadata, value) {
  const rating = Math.max(0, Math.min(RATING_MAX, Math.round(Number(value) || 0)));
  return { ...(metadata || {}), rating, ratingScale: RATING_MAX };
}

// Number keys while reviewing: 1–9 rate that many stars, 0 rates 10.
export function ratingFromKey(key) {
  if (!/^[0-9]$/.test(String(key))) return null;
  return key === '0' ? RATING_MAX : Number(key);
}
