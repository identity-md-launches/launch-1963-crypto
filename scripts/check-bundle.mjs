import { readdir, stat, readFile, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
const ignored = new Set([".git", ".github", ".imd", "node_modules"]);
let bytes = 0,
  files = 0;
const forbidden = [];
async function walk(dir = ".") {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (
      ignored.has(e.name) ||
      e.name === ".env" ||
      e.name.startsWith(".env.") ||
      (dir === "test" && e.name === "scratch")
    )
      continue;
    const path = join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error("Unexpected symlink: " + path);
    if (e.isDirectory()) await walk(path);
    else {
      bytes += (await stat(path)).size;
      files++;
      if (/\.(tgz|tar|zip)$/.test(path)) forbidden.push(path);
    }
  }
}
await walk();
if (bytes > 8388608) throw new Error("Submission exceeds 8 MiB: " + bytes);
if (forbidden.length)
  throw new Error("Unneeded dependency archives: " + forbidden.join(","));
for (const name of [
  "dist/index.html",
  "dist/assets/app.js",
  "dist/assets/style.css",
  "dist/favicon.svg",
  "dist/share.svg",
  "README.md",
  "DESIGN.md",
  "VALIDATION.md",
  "package-lock.json",
])
  await access(name);
for (const e of await readdir("dist/assets"))
  if (e.endsWith(".js")) {
    const source = await readFile(join("dist/assets", e), "utf8");
    for (const m of source.matchAll(/from\s+["'](\.[^"']+)["']/g))
      await access(resolve("dist/assets", m[1]));
  }
const html = await readFile("dist/index.html", "utf8");
for (const m of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))
  await access(resolve("dist", m[1]));
const fonts = await readFile("dist/fonts/font-faces.css", "utf8");
for (const m of fonts.matchAll(/url\(["']?([^"')]+)["']?\)/g))
  await access(resolve(dirname("dist/fonts/font-faces.css"), m[1]));
console.log(
  JSON.stringify(
    {
      files,
      bytes,
      limit: 8388608,
      relativeRuntimeAssets: "complete",
      archives: forbidden.length,
    },
    null,
    2,
  ),
);
