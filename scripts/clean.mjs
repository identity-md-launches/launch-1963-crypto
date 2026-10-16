import { rm } from "node:fs/promises";
// Only the generated export is removed; source and user data are never part of dist.
await rm(new URL("../dist/", import.meta.url), {
  recursive: true,
  force: true,
});
