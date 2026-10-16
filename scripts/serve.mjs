import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
};
const digest = (s) => createHash("sha256").update(s).digest();
export function makeServer({
  root = resolve(fileURLToPath(new URL("../dist/", import.meta.url))),
  credentials = null,
} = {}) {
  return createServer(async (req, res) => {
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.coingecko.com; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    };
    const send = (code, body, more = {}) => {
      res.writeHead(code, { ...headers, ...more });
      res.end(req.method === "HEAD" ? "" : body);
    };
    if (credentials) {
      const auth = req.headers.authorization ?? "";
      let value = "";
      try {
        if (auth.startsWith("Basic "))
          value = Buffer.from(auth.slice(6), "base64").toString("utf8");
      } catch {}
      if (
        !timingSafeEqual(
          digest(value),
          digest(`${credentials.username}:${credentials.password}`),
        )
      )
        return send(401, "Authentication required", {
          "WWW-Authenticate":
            'Basic realm="Shizhang Private Ledger", charset="UTF-8"',
        });
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      return send(405, "Method not allowed", { Allow: "GET, HEAD" });
    try {
      const url = new URL(req.url, "http://localhost");
      let path = decodeURIComponent(url.pathname);
      if (path.startsWith("/preview/")) path = path.slice("/preview".length);
      if (path === "/" || path.endsWith("/")) path += "index.html";
      const file = resolve(root, "." + path);
      if (!file.startsWith(root + sep)) return send(403, "Forbidden");
      if (!(await stat(file)).isFile()) return send(404, "Not found");
      const content = await readFile(file);
      send(200, content, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
      });
    } catch {
      send(404, "Not found");
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const host = flag("--host", "127.0.0.1"),
    port = Number(flag("--port", "4173"));
  const auth = args.includes("--auth");
  if (!auth && !["127.0.0.1", "localhost", "::1"].includes(host)) {
    console.error(
      "External listening requires --auth. Put HTTPS in front of this server.",
    );
    process.exit(1);
  }
  let credentials = null;
  if (auth) {
    const username = process.env.LEDGER_USER,
      password = process.env.LEDGER_PASSWORD;
    if (
      !username ||
      username.includes(":") ||
      !password ||
      password.length < 12
    ) {
      console.error(
        "Set LEDGER_USER (no colon) and LEDGER_PASSWORD (at least 12 characters) in the service configuration. Credentials are never served to the browser.",
      );
      process.exit(1);
    }
    credentials = { username, password };
  }
  const server = makeServer({ credentials });
  server.listen(port, host, () =>
    console.log(
      `Ledger preview ready on port ${port}${auth ? " (authentication required)" : ""}. Use HTTPS for remote access.`,
    ),
  );
}
