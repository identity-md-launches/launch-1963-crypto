import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { makeServer } from "../scripts/serve.mjs";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const axeSource = await readFile(process.argv[3], "utf8");
const server = makeServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const report = {
  accessibility: [],
  stress: [],
  persistence: [],
  liveMarket: null,
};
await mkdir("test/scratch/quality", { recursive: true });
try {
  await page.goto(url);
  await page.locator("h1").waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const route of [
    "dashboard",
    "investments",
    "holdings",
    "cash",
    "prices",
    "data",
  ]) {
    await page.goto(url + "#" + route);
    await page.locator("h1").waitFor();
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => {
      const r = await window.axe.run(document.querySelector("#app"), {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      }));
    });
    report.accessibility.push({ route, violations });
    assert.equal(
      violations.length,
      0,
      JSON.stringify({ route, violations }, null, 2),
    );
  }
  console.log("PASS axe WCAG 2 A/AA + 2.1 AA: all six pages");
  await page.goto(url);
  await page.locator('[data-action="new"]').click();
  await page.evaluate(axeSource);
  const modalAxe = await page.evaluate(async () => {
    const r = await window.axe.run(document.querySelector("dialog"), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    return r.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.failureSummary),
    }));
  });
  assert.deepEqual(modalAxe, []);
  report.accessibility.push({
    route: "investment-dialog",
    violations: modalAxe,
  });
  const focusBefore = await page
    .locator("dialog")
    .evaluate((d) => d.contains(document.activeElement));
  assert.ok(focusBefore);
  for (let i = 0; i < 60; i++) await page.keyboard.press("Tab");
  assert.ok(
    await page
      .locator("dialog")
      .evaluate((d) => d.contains(document.activeElement)),
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.action),
    "new",
  );
  console.log(
    "PASS dialog keyboard focus trap and return, labels and contrast",
  );
  await page.evaluate(async () => {
    const { demoBook } = await import("./assets/demo.js");
    const { base } = await import("./assets/model.js");
    const b = demoBook();
    b.projects[0].name =
      '<img src=x onerror="window.__injected=1">' + "超长投资项目".repeat(11);
    b.projects[0].account = "0x" + "f".repeat(118);
    b.entries.find((e) => e.kind === "cash").id =
      'cash" onclick="window.__injected=1';
    b.entries.push({
      ...base("2026-01-01"),
      kind: "opening",
      asset: "USD",
      qty: "999999999999999.123456789012345678",
      reason: "最大金额与完整精度",
    });
    localStorage.setItem("shizhang.demo.v1", JSON.stringify(b));
  });
  await page.reload();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "dashboard",
      "investments",
      "holdings",
      "cash",
      "prices",
      "data",
    ]) {
      await page.goto(url + "#" + route);
      await page.locator("h1").waitFor();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
      );
      assert.equal(overflow, false, `stress overflow ${route}@${width}`);
      assert.equal(await page.locator('#app img[src="x"]').count(), 0);
      assert.equal(await page.evaluate(() => window.__injected), undefined);
      report.stress.push(`${route}@${width}`);
    }
    await page.goto(url + "#investments");
    await page.locator('[data-action="project"]').first().click();
    assert.equal(
      await page
        .locator("dialog")
        .evaluate((d) => d.scrollWidth > d.clientWidth + 1),
      false,
    );
    await page.keyboard.press("Escape");
  }
  console.log(
    "PASS max decimal amounts, long names and quoted IDs across 18 page/width combinations; text remains inert",
  );
  // Storage writes must either persist completely or leave the saved book unchanged.
  await page.evaluate(() => localStorage.removeItem("shizhang.demo.v1"));
  await page.reload();
  await page.locator('[data-action="new-cash"]').count();
  await page.locator('[data-action="vault"]').first().click();
  await page.locator('[name="password"]').fill("quality-test-password");
  await page.locator('[name="confirm"]').fill("quality-test-password");
  await page.locator('dialog button[type="submit"]').click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  const other = await context.newPage();
  await other.goto(url);
  await other.locator('[data-action="vault"]').first().click();
  await other.locator('[name="password"]').fill("quality-test-password");
  await other.locator('dialog button[type="submit"]').click();
  await other.locator("dialog").waitFor({ state: "hidden" });
  await page.goto(url + "#holdings");
  await page.locator('[data-action="new-adjustment"]').click();
  await page.locator('[name="qty"]').fill("100");
  await page.locator('[name="reason"]').fill("第一标签期初");
  await page.locator('dialog button[type="submit"]').click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await other.goto(url + "#holdings");
  await other.locator('[data-action="new-adjustment"]').click();
  await other.locator('[name="qty"]').fill("200");
  await other.locator('[name="reason"]').fill("过期标签不得覆盖");
  await other.locator('dialog button[type="submit"]').click();
  await other.getByRole("alert").filter({ hasText: "另一个标签页" }).waitFor();
  await other.close();
  const raw = await page.evaluate(() =>
    localStorage.getItem("shizhang.vault.v1"),
  );
  await page.locator('[data-action="new-adjustment"]').click();
  await page.locator('[name="qty"]').fill("300");
  await page.locator('[name="reason"]').fill("空间不足测试");
  await page.evaluate(() => {
    window.__originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("fixture quota", "QuotaExceededError");
    };
  });
  await page.locator('dialog button[type="submit"]').click();
  await page.getByRole("alert").filter({ hasText: "空间不足" }).waitFor();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("shizhang.vault.v1")),
    raw,
  );
  assert.equal(await page.locator('[name="qty"]').inputValue(), "300");
  await page.evaluate(() => (Storage.prototype.setItem = window.__originalSet));
  await page.keyboard.press("Escape");
  report.persistence = [
    "stale tab cannot overwrite newer vault",
    "quota failure leaves persisted data unchanged and form available",
  ];
  console.log("PASS multi-tab conflict and quota failure recovery");
  // One live provider request, recorded separately from deterministic mocked tests.
  const live = await page.evaluate(async () => {
    const { refreshPrices } = await import("./assets/prices.js");
    const { emptyBook } = await import("./assets/model.js");
    const p = await refreshPrices(emptyBook().prices);
    return Object.fromEntries(
      Object.entries(p)
        .filter(([a]) => a !== "USD")
        .map(([a, v]) => [
          a,
          { hasPrice: !!v.value, at: v.at, error: v.error },
        ]),
    );
  });
  report.liveMarket = live;
  console.log("LIVE MARKET " + JSON.stringify(live));
  await writeFile(
    "test/scratch/quality/result.json",
    JSON.stringify(report, null, 2),
  );
} catch (e) {
  await page.screenshot({
    path: "test/scratch/quality/failure.png",
    fullPage: true,
  });
  await writeFile(
    "test/scratch/quality/result.json",
    JSON.stringify(report, null, 2),
  );
  throw e;
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
