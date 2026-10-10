import fs from "node:fs";
// pg connection-string ssl flags can override the explicit ssl object. Reject ambiguous input.
export function databaseOptions(env = process.env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const url = new URL(env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Expected a PostgreSQL URL");
  for (const key of url.searchParams.keys()) {
    if (/^ssl/i.test(key) || key === "uselibpqcompat")
      throw new Error(
        "Configure database TLS with PG_TLS_MODE and PG_CA_FILE, not URL ssl parameters",
      );
  }
  const mode = env.PG_TLS_MODE || "verify-full";
  if (!["verify-full", "local"].includes(mode))
    throw new Error(
      "Invalid PG_TLS_MODE: remote connections require certificate verification",
    );
  if (
    mode === "local" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("Local TLS mode requires loopback");
  if (
    mode === "verify-full" &&
    url.hostname.startsWith("dpg-") &&
    !url.hostname.includes(".")
  )
    throw new Error(
      "Use the full external Render hostname for verified TLS; internal certificates are self-signed",
    );
  return {
    connectionString: url.toString(),
    ssl:
      mode === "verify-full"
        ? {
            rejectUnauthorized: true,
            ...(env.PG_CA_FILE
              ? { ca: fs.readFileSync(env.PG_CA_FILE, "utf8") }
              : {}),
          }
        : false,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  };
}
