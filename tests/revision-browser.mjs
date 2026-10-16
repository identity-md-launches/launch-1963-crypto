import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { makeServer } from "../scripts/serve.mjs";

// All ledger data and passwords in this test are fictional, isolated browser fixtures.
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const reproduce = process.argv.includes("--reproduce");
const out = "test/scratch/revision";
await mkdir(out, { recursive: true });
const server = makeServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({ headless: true });
const password = "revision-fixture-original";
const newPassword = "revision-fixture-changed";
const report = { mode: reproduce ? "before-fix" : "regression", checks: {}, errors: [] };
const contexts = [];
async function context(width = 1440) {
  const c = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, acceptDownloads: true });
  contexts.push(c);
  c.on("page", (page) => page.on("pageerror", (e) => report.errors.push(String(e))));
  return c;
}
async function pageIn(c) {
  const page = await c.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(url);
  await page.locator("h1").waitFor();
  return page;
}
const action = (page, name) => page.locator(`[data-action="${name}"]`).first().click();
const fill = (page, name, value) => page.locator(`[name="${name}"]`).fill(String(value));
async function submit(page) {
  await page.locator('dialog button[type="submit"]').click();
  await page.locator("dialog").waitFor({ state: "hidden" });
}
async function vaultForm(page, create = true, pass = password) {
  await action(page, "vault");
  await fill(page, "password", pass);
  if (create) await fill(page, "confirm", pass);
}
async function deposit(page, amount = 1000, date = "2026-01-01") {
  await page.getByRole("link", { name: "法币出入金", exact: true }).click();
  await action(page, "new-cash");
  await fill(page, "date", date);
  await fill(page, "fiatAmount", amount * 7);
  await fill(page, "usdAmount", amount);
  await submit(page);
}
const rawVault = (page) => page.evaluate(() => localStorage.getItem("shizhang.vault.v1"));
async function snapshot(page, pass = password) {
  return page.evaluate(async (pass) => {
    const { unseal } = await import("./assets/storage.js");
    const { calculate } = await import("./assets/engine.js");
    const { str } = await import("./assets/decimal.js");
    const { book } = await unseal(localStorage.getItem("shizhang.vault.v1"), pass);
    const result = calculate(book);
    return { book, quantity: str(result.holdings.USD.qty), net: str(result.netDeposit) };
  }, pass);
}
async function attemptSubmit(page) {
  await page.locator('dialog button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector("dialog").open ||
    !!document.querySelector("#form-error:not([hidden])")?.textContent);
  const error = page.locator("#form-error:not([hidden])");
  return await error.count() ? await error.textContent() : "";
}
const record = (name, value) => {
  report.checks[name] = value;
  console.log(`${reproduce ? "OBSERVED" : "CHECK"} ${name}: ${JSON.stringify(value)}`);
};
try {
  const sourceContext = await context();
  const a = await pageIn(sourceContext);
  a.on("dialog", (d) => d.accept());
  await vaultForm(a);
  await submit(a);
  await deposit(a);
  await deposit(a);
  const original = await snapshot(a);
  assert.equal(original.quantity, "2000");
  assert.equal(original.book.entries.length, 2);
  assert.notEqual(original.book.entries[0].id, original.book.entries[1].id);
  await a.getByRole("link", { name: "数据管理", exact: true }).click();
  const download = a.waitForEvent("download");
  await action(a, "export-csv");
  await (await download).saveAs(out + "/roundtrip.csv");
  const csv = await readFile(out + "/roundtrip.csv");
  const importedPage = await pageIn(await context());
  await vaultForm(importedPage);
  await submit(importedPage);
  await importedPage.getByRole("link", { name: "数据管理", exact: true }).click();
  async function importFile() {
    await action(importedPage, "import");
    await importedPage.locator("#csv-file").setInputFiles({ name: "roundtrip.csv", mimeType: "text/csv", buffer: csv });
    await importedPage.locator(".import-summary").waitFor();
    const summary = await importedPage.locator(".import-summary").textContent();
    await action(importedPage, "confirm-import");
    await importedPage.locator("dialog").waitFor({ state: "hidden" });
    return summary;
  }
  const preview = await importFile();
  const imported = await snapshot(importedPage);
  const repeatedPreview = await importFile();
  record("csv", { preview, entries: imported.book.entries.length, quantity: imported.quantity, net: imported.net, repeatedPreview });
  if (!reproduce) {
    assert.equal(imported.quantity, "2000");
    assert.equal(imported.net, "2000");
    assert.deepEqual(imported.book.entries, original.book.entries);
    assert.match(repeatedPreview, /新增 0 条 · 重复跳过 2 条/);
    assert.deepEqual((await snapshot(importedPage)).book.entries, original.book.entries);
  }

  const b = await pageIn(sourceContext);
  await vaultForm(b, false);
  await submit(b);
  await deposit(a, 300, "2026-01-02");
  await b.getByText(/另一个标签页已修改账本/).waitFor();
  const latest = await snapshot(a);
  const latestRaw = await rawVault(a);
  assert.equal(latest.quantity, "2300");
  await b.getByRole("link", { name: "数据管理", exact: true }).click();
  await action(b, "change-password");
  await fill(b, "password", newPassword);
  await fill(b, "confirm", newPassword);
  const error = await attemptSubmit(b);
  const unchanged = (await rawVault(a)) === latestRaw;
  const afterChange = await snapshot(a, unchanged ? password : newPassword);
  record("stale-password", { error, unchanged, entries: afterChange.book.entries.length, quantity: afterChange.quantity });
  if (!reproduce) {
    assert.match(error, /另一个标签页.*重新解锁/);
    assert.equal(unchanged, true);
    assert.deepEqual(afterChange.book, latest.book);
    assert.equal(await b.locator('[name="password"]').inputValue(), newPassword);
    await b.keyboard.press("Escape");
    await action(b, "lock");
    await vaultForm(b, false);
    await submit(b);
    await action(b, "change-password");
    await fill(b, "password", newPassword);
    await fill(b, "confirm", newPassword);
    await submit(b);
    const changed = await snapshot(b, newPassword);
    assert.deepEqual(changed.book.entries, latest.book.entries);
    assert.equal(changed.quantity, "2300");
    await assert.rejects(snapshot(b, password), /口令/);
    record("password-retry", { entries: changed.book.entries.length, quantity: changed.quantity, oldPasswordRejected: true });

    // A writer already holding the save lock may commit while rekeying is queued.
    // The rekey operation must compare against its original version after acquiring it.
    await a.evaluate(async () => {
      const { unseal, seal, VAULT_KEY, PREVIOUS_KEY } = await import("./assets/storage.js");
      const { base } = await import("./assets/model.js");
      const raw = localStorage.getItem(VAULT_KEY);
      const opened = await unseal(raw, "revision-fixture-changed");
      opened.book.entries.push({ ...base("2026-01-03"), kind: "cash", direction: "in", fiat: "CNY", fiatAmount: "4900", usdAmount: "700", rate: "7", fee: "0", payment: "USD", paymentAmount: "700" });
      opened.book.revision++;
      const encoded = await seal(opened.book, opened.session);
      window.__lockDone = navigator.locks.request("shizhang-save", async () => {
        window.__holdingLock = true;
        await new Promise((resolve) => { window.__releaseLock = resolve; });
        localStorage.setItem(PREVIOUS_KEY, raw);
        localStorage.setItem(VAULT_KEY, encoded);
      });
    });
    await a.waitForFunction(() => window.__holdingLock);
    await action(b, "change-password");
    await fill(b, "password", "revision-fixture-third");
    await fill(b, "confirm", "revision-fixture-third");
    await b.locator('dialog button[type="submit"]').click();
    await b.waitForFunction(async () => (await navigator.locks.query()).pending.some((lock) => lock.name === "shizhang-save"));
    await a.evaluate(async () => { window.__releaseLock(); await window.__lockDone; });
    await b.locator("#form-error").filter({ hasText: "重新解锁" }).waitFor();
    const queuedResult = await snapshot(b, newPassword);
    assert.equal(queuedResult.quantity, "3000");
    assert.equal(queuedResult.book.entries.length, 4);
    await assert.rejects(snapshot(b, "revision-fixture-third"), /口令/);
    record("queued-password", { entries: queuedResult.book.entries.length, quantity: queuedResult.quantity, rejectedAfterLockAcquired: true });
  }

  const creationContext = await context();
  const first = await pageIn(creationContext);
  const stale = await pageIn(creationContext);
  await vaultForm(first);
  await vaultForm(stale, true, newPassword);
  await submit(first);
  await deposit(first, 300);
  const createdRaw = await rawVault(first);
  const creationError = await attemptSubmit(stale);
  const preserved = (await rawVault(first)) === createdRaw;
  record("stale-create", { error: creationError, preserved });
  if (!reproduce) {
    assert.equal(preserved, true);
    assert.match(creationError, /另一个标签页|已存在/);
    assert.equal((await snapshot(first)).quantity, "300");
  }

  const mobile = await pageIn(await context(390));
  await mobile.getByRole("link", { name: "投资记录", exact: true }).click();
  await action(mobile, "new");
  const hint = () => mobile.locator("p.field-help").filter({ hasText: "项目剩余成本" }).allTextContents();
  const initialHint = await hint();
  await fill(mobile, "costQty", "12.5");
  await mobile.locator('[name="projectId"]').selectOption({ label: "ETH 节点计划" });
  const ethHint = await hint();
  await mobile.screenshot({ path: out + "/390-project-eth.png" });
  const beforeTop = await mobile.locator(".money-group").first().evaluate((e) => e.getBoundingClientRect().top);
  await mobile.locator('[name="projectId"]').selectOption("new");
  const newHintVisible = await mobile.locator("p.field-help").filter({ hasText: "项目剩余成本" }).isVisible().catch(() => false);
  const newHint = await hint();
  // New-project fields replace the summary in normal flow; no blank summary remains.
  const newFieldsVisible = await mobile.locator("#new-project-fields").isVisible();
  record("project-hint", { initialHint, ethHint, newHint, newHintVisible, newFieldsVisible, beforeTop });
  if (!reproduce) {
    assert.match(initialHint.join(""), /6 SOL/);
    assert.match(ethHint.join(""), /项目剩余成本：0；占用 2 ETH/);
    assert.equal(newHintVisible, false);
    assert.equal(newFieldsVisible, true);
    assert.equal(await mobile.locator('[name="costQty"]').inputValue(), "12.5");
    await mobile.locator('[name="projectId"]').selectOption({ label: "Solana 生态探索" });
    assert.match((await hint()).join(""), /6 SOL/);
    assert.equal(await mobile.locator("#new-project-fields").isVisible(), false);
  }
  await mobile.keyboard.press("Escape");
  await mobile.getByRole("link", { name: "仪表盘", exact: true }).click();
  await mobile.getByRole("heading", { name: "资产一览", exact: true }).waitFor();
  const subtitle = await mobile.locator(".page-heading p").textContent();
  await mobile.screenshot({ path: out + "/390-dashboard.png", fullPage: true });
  record("dashboard-copy", { subtitle });
  if (!reproduce) assert.equal(subtitle, "持仓与估值为当前数据；已结算盈亏和净入金可按日期筛选。");

  const timerContext = await context();
  let requests = 0;
  await timerContext.route("https://api.coingecko.com/**", async (route) => {
    requests++;
    await route.fulfill({ json: Object.fromEntries(["bitcoin", "ethereum", "binancecoin", "solana"].map((id, i) => [id, { usd: [60000, 2000, 500, 100][i], last_updated_at: 1792152000 }])) });
  });
  const timed = await pageIn(timerContext);
  await timed.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
  await timed.clock.pauseAt(new Date("2026-10-16T12:00:01Z"));
  await timed.getByRole("link", { name: "币价更新", exact: true }).click();
  await timed.locator('[name="auto"]').check();
  await timed.locator('[name="interval"]').selectOption("1");
  await timed.locator('#price-settings button[type="submit"]').click();
  await timed.getByRole("link", { name: "持仓", exact: true }).click();
  const counts = [];
  for (const seconds of [45, 90, 135, 180]) {
    await timed.clock.runFor(45000);
    // Wait for any in-flight network response and save, without advancing the virtual clock.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await action(timed, "new-adjustment");
    await fill(timed, "qty", "1");
    await fill(timed, "reason", "定时器审查");
    await submit(timed);
    counts.push({ seconds, requests });
  }
  await timed.clock.runFor(59000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  counts.push({ seconds: 239, requests });
  record("price-timer", { counts });
  if (!reproduce) {
    assert.deepEqual(counts.map((x) => x.requests), [0, 1, 2, 3, 3]);
    await timed.getByRole("link", { name: "币价更新", exact: true }).click();
    await timed.locator('[name="auto"]').uncheck();
    await timed.locator('#price-settings button[type="submit"]').click();
    await timed.clock.runFor(120000);
    assert.equal(requests, 3);
    record("price-disabled", { requests });
    await timed.locator('[name="auto"]').check();
    await timed.locator('[name="interval"]').selectOption("2");
    await timed.locator('#price-settings button[type="submit"]').click();
    await timed.clock.runFor(45000);
    // Resaving identical settings and a manual price must keep the 2-minute deadline.
    await timed.locator('#price-settings button[type="submit"]').click();
    await timed.locator('[data-action="manual-price"][data-asset="ETH"]').click();
    await fill(timed, "value", "2100");
    await submit(timed);
    await timed.clock.runFor(74000);
    assert.equal(requests, 3);
    await timed.clock.runFor(1000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(requests, 4);
    record("price-reschedule", { interval: 2, requests, unchangedSettingsAndManualPriceKeptDeadline: true });
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(out + (reproduce ? "/before.json" : "/result.json"), JSON.stringify(report, null, 2));
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
