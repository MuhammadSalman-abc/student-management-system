const getSessionSettings = (env = process.env) => {
  const configuredJwtExpiresIn = env.JWT_EXPIRES_IN || "1h";
  const duration = configuredJwtExpiresIn.match(/^([1-9]\d*)(s|m|h|d)?$/);
  if (!duration) {
    throw new Error("JWT_EXPIRES_IN must be a positive number of seconds or a duration such as 15m, 1h, or 7d.");
  }
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[duration[2] || "s"];
  const jwtLifetimeMs = Number(duration[1]) * multiplier * 1000;
  if (!Number.isSafeInteger(jwtLifetimeMs)) {
    throw new Error("JWT_EXPIRES_IN exceeds the supported duration.");
  }
  // jsonwebtoken interprets numeric values as seconds, but numeric strings as
  // milliseconds through its duration parser. Normalize plain seconds to a number.
  const jwtExpiresIn = duration[2] ? configuredJwtExpiresIn : Number(duration[1]);

  const cookieMaxAgeMs = env.JWT_COOKIE_MAX_AGE_MS === undefined
    ? 60 * 60 * 1000
    : Number(env.JWT_COOKIE_MAX_AGE_MS);
  if (!Number.isSafeInteger(cookieMaxAgeMs) || cookieMaxAgeMs < 1000) {
    throw new Error("JWT_COOKIE_MAX_AGE_MS must be a whole number of at least 1000 milliseconds.");
  }
  if (cookieMaxAgeMs > jwtLifetimeMs) {
    throw new Error("JWT_COOKIE_MAX_AGE_MS cannot exceed the JWT_EXPIRES_IN lifetime.");
  }
  return { jwtExpiresIn, cookieMaxAgeMs };
};

module.exports = getSessionSettings;
