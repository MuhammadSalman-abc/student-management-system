const parseBoolean = (value, name) => {
  if (value === undefined || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
};

const getEmailSettings = (env = process.env) => {
  const configured = ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASS"]
    .some((key) => env[key] !== undefined && env[key] !== "");
  if (!configured) return { configured: false };

  const host = typeof env.SMTP_HOST === "string" ? env.SMTP_HOST.trim() : "";
  const from = typeof env.SMTP_FROM === "string" ? env.SMTP_FROM.trim() : "";
  if (!host || host.length > 253 || /[\s\r\n]/.test(host)) throw new Error("SMTP_HOST must be a valid host name.");
  if (!from || from.length > 254 || /[\r\n]/.test(from) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)) {
    throw new Error("SMTP_FROM must be a valid sender email address.");
  }

  const port = env.SMTP_PORT === undefined || env.SMTP_PORT === "" ? 587 : Number(env.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT must be a valid TCP port.");
  const secure = parseBoolean(env.SMTP_SECURE, "SMTP_SECURE") ?? port === 465;
  const requireTLS = parseBoolean(env.SMTP_REQUIRE_TLS, "SMTP_REQUIRE_TLS") ?? !secure;
  if (env.NODE_ENV === "production" && !secure && !requireTLS) {
    throw new Error("SMTP_REQUIRE_TLS must remain enabled for production SMTP delivery.");
  }

  const user = typeof env.SMTP_USER === "string" ? env.SMTP_USER : "";
  const pass = typeof env.SMTP_PASS === "string" ? env.SMTP_PASS : "";
  if (Boolean(user) !== Boolean(pass)) throw new Error("Set both SMTP_USER and SMTP_PASS, or leave both empty for an authenticated network relay.");
  if (user.length > 254 || pass.length > 1024) throw new Error("SMTP credentials exceed the supported length.");

  return {
    configured: true,
    host,
    port,
    secure,
    requireTLS,
    from,
    auth: user ? { user, pass } : undefined,
  };
};

module.exports = getEmailSettings;
