import { cp, mkdir } from "node:fs/promises";
await mkdir("dist/assets", { recursive: true });
await cp("index.html", "dist/index.html");
await cp("src/style.css", "dist/assets/style.css");
await cp("public", "dist", { recursive: true });
console.log(
  "Production export: dist/ (relative ES modules, no runtime dependencies)",
);
