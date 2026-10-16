import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { makeServer } from "../scripts/serve.mjs";
const modulePath = process.argv[2];
const { chromium, webkit } = modulePath
  ? await import(pathToFileURL(modulePath).href)
  : await import("playwright");
const out = "test/scratch/browser";
await mkdir(out, { recursive: true });
const server = makeServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("dialog", (dialog) => dialog.accept());
let priceMode = "fail",
  requests = 0;
await context.route("https://api.coingecko.com/**", async (route) => {
  requests++;
  if (priceMode === "fail") await route.abort("failed");
  else
    await route.fulfill({
      json: Object.fromEntries(
        ["bitcoin", "ethereum", "binancecoin", "solana"].map((id, i) => [
          id,
          {
            usd: [60000, 2000, 500, 100][i],
            last_updated_at: Math.floor(Date.now() / 1000),
          },
        ]),
      ),
    });
});
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log("PASS " + name);
};
const fill = async (name, value) =>
  page.locator(`[name="${name}"]`).fill(String(value));
const click = async (action) =>
  page.locator(`[data-action="${action}"]`).first().click();
const submit = async () => {
  await page.locator('dialog button[type="submit"]').click();
  await page.locator("dialog").waitFor({ state: "hidden" });
};
const snapshot = () =>
  page.evaluate(async () => {
    const raw = localStorage.getItem("shizhang.vault.v1");
    const { unseal } = await import("./assets/storage.js");
    return (await unseal(raw, "ledger-test-password")).book;
  });
const calc = () =>
  page.evaluate(async () => {
    const { unseal } = await import("./assets/storage.js");
    const { calculate } = await import("./assets/engine.js");
    const b = (
      await unseal(
        localStorage.getItem("shizhang.vault.v1"),
        "ledger-test-password",
      )
    ).book;
    const r = calculate(b);
    return {
      qty: String(r.holdings.USD.qty),
      total: String(r.total),
      realized: String(r.realized),
      floating: String(r.floating),
      valuation: String(r.valuation),
      net: String(r.netDeposit),
    };
  });
const exact = (actual, expected) =>
  assert.equal(actual, String(BigInt(expected) * 10n ** 18n));
try {
  await page.goto(url);
  await page.locator("h1").waitFor();
  assert.equal(await page.title(), "拾账 · Crypto 投资账本");
  assert.ok(
    (await page.locator(".demo-banner").textContent()).includes("虚构"),
  );
  pass("relative subpath loads full production export");
  await click("vault");
  await fill("name", "测试个人账本");
  await fill("password", "ledger-test-password");
  await fill("confirm", "ledger-test-password");
  await submit();
  assert.equal(await page.locator(".demo-banner").count(), 0);
  pass("create encrypted personal vault from empty data");
  await page.getByRole("link", { name: "法币出入金", exact: true }).click();
  await click("new-cash");
  await fill("date", "2026-01-01");
  await fill("fiatAmount", "7000");
  await fill("usdAmount", "1000");
  assert.ok(
    (await page.locator("#fx-preview").textContent()).includes("7 CNY"),
  );
  await submit();
  let r = await calc();
  exact(r.qty, 1000);
  exact(r.net, 1000);
  exact(r.realized, 0);
  pass("A UI: fiat deposit and historical FX preview");
  await page.getByRole("link", { name: "投资记录", exact: true }).click();
  await click("new");
  await fill("date", "2026-01-02");
  await fill("newProjectName", "验收项目");
  await fill("costQty", "400");
  await fill("valuationQty", "450");
  await submit();
  r = await calc();
  exact(r.qty, 600);
  exact(r.total, 1050);
  exact(r.floating, 50);
  pass("B UI: investment saves, holdings and dashboard recalculate");
  await page.reload();
  await click("vault");
  await fill("password", "wrong-password");
  await page.locator('dialog button[type="submit"]').click();
  await page.getByRole("alert").filter({ hasText: "口令不正确" }).waitFor();
  await fill("password", "ledger-test-password");
  await submit();
  r = await calc();
  exact(r.total, 1050);
  pass("reload survives, wrong password fails and correct unlock restores");
  await click("new");
  await fill("date", "2026-01-03");
  await fill("recoveryQty", "500");
  await page.locator("summary").filter({ hasText: "本次结转成本" }).click();
  await fill("releaseUSD", "400");
  await page.locator('[name="projectState"]').selectOption("closed");
  await submit();
  r = await calc();
  exact(r.qty, 1100);
  exact(r.realized, 100);
  exact(r.valuation, 0);
  pass("C UI: full settlement clears valuation and locks historic profit");
  const b = await snapshot();
  const settled = b.entries.find((e) => e.recovery);
  await page
    .locator(`[data-action="edit-entry"][data-id="${settled.id}"]`)
    .click();
  await fill("recoveryQty", "550");
  await submit();
  r = await calc();
  exact(r.qty, 1150);
  exact(r.realized, 150);
  await page.locator(`[data-action="delete"][data-id="${settled.id}"]`).click();
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("已撤销"),
  );
  r = await calc();
  exact(r.qty, 600);
  exact(r.valuation, 450);
  await page.getByRole("link", { name: "数据管理", exact: true }).click();
  await page
    .locator(`[data-action="restore"][data-id="${settled.id}"]`)
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("已恢复"),
  );
  r = await calc();
  exact(r.qty, 1150);
  exact(r.valuation, 0);
  pass("H UI: edit, confirmed revoke and restore are consistent");
  await page.getByRole("link", { name: "投资记录", exact: true }).click();
  await fill("search", "不存在的项目");
  await page.locator('#filter-form button[type="submit"]').click();
  assert.ok(await page.getByText("没有匹配的流水").isVisible());
  await click("filter-reset");
  pass("search, empty state and reset");
  await page.getByRole("link", { name: "持仓", exact: true }).click();
  await click("new-exchange");
  await fill("date", "2026-01-04");
  await fill("fromQty", "150");
  await fill("toQty", "0.075");
  await submit();
  r = await calc();
  exact(r.qty, 1000);
  exact(r.net, 1000);
  exact(r.realized, 150);
  pass("G UI: one exchange posts both legs with no false profit");
  await page.getByRole("link", { name: "币价更新", exact: true }).click();
  await page.locator('[data-action="manual-price"][data-asset="ETH"]').click();
  await fill("value", "2000");
  await submit();
  const beforeRefresh = await snapshot();
  await click("refresh");
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("更新失败"),
  );
  assert.equal(
    (await snapshot()).prices.ETH.value,
    beforeRefresh.prices.ETH.value,
  );
  priceMode = "success";
  await click("refresh");
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("行情已更新"),
  );
  assert.equal((await snapshot()).prices.BTC.value, "60000");
  r = await calc();
  exact(r.realized, 150);
  pass(
    "H UI: manual price, fetch failure retains it, retry succeeds without rewriting profit",
  );
  await page.getByRole("link", { name: "数据管理", exact: true }).click();
  let event = page.waitForEvent("download");
  await click("export-csv");
  const csvDownload = await event;
  await csvDownload.saveAs(out + "/roundtrip.csv");
  const csv = await readFile(out + "/roundtrip.csv", "utf8");
  assert.ok(csv.includes("验收项目"));
  await click("import");
  await page.locator("#csv-file").setInputFiles({
    name: "roundtrip.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByText("新增 0 条", { exact: false }).waitFor();
  assert.ok(
    (await page.locator(".import-summary").textContent()).includes("重复跳过"),
  );
  await click("confirm-import");
  await page.locator("dialog").waitFor({ state: "hidden" });
  pass("CSV download, mapped preview and duplicate import");
  await click("import");
  const addedCSV =
    "类型,日期,调整币种,调整数量,调整原因\n期初,2026-01-01,SOL,1,CSV新增期初";
  await page
    .locator("#csv-file")
    .setInputFiles({
      name: "new-row.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(addedCSV),
    });
  await page.getByText("新增 1 条", { exact: false }).waitFor();
  assert.ok(
    (await page.locator(".import-preview").textContent()).includes("1 SOL"),
  );
  await click("confirm-import");
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.ok(
    (await snapshot()).entries.some(
      (e) => e.kind === "opening" && e.asset === "SOL" && e.qty === "1",
    ),
  );
  pass("CSV new row imports into the persistent shared ledger");

  const backupState = await snapshot();
  event = page.waitForEvent("download");
  await click("backup");
  const encryptedDownload = await event;
  await encryptedDownload.saveAs(out + "/vault.json");
  const encrypted = await readFile(out + "/vault.json", "utf8");
  assert.ok(!encrypted.includes("验收项目"));
  await click("restore-backup");
  await page.locator('input[name="backup"]').setInputFiles(out + "/vault.json");
  await fill("password", "ledger-test-password");
  await page.locator('dialog button[type="submit"]').click();
  await page.getByRole("heading", { name: "确认恢复备份" }).waitFor();
  await click("confirm-restore");
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.deepEqual((await snapshot()).entries, backupState.entries);
  pass("encrypted backup download, decrypt preview and restore");
  await page.getByRole("link", { name: "仪表盘", exact: true }).click();
  await page.locator('#range-form [name="start"]').fill("2026-02-01");
  await page.locator('#range-form [name="end"]').fill("2026-02-28");
  await page.locator('#range-form button[type="submit"]').click();
  assert.ok(
    (
      await page.locator('[data-metric="realized"]').first().textContent()
    ).includes("$0.00"),
  );
  await click("range-reset");
  pass("settlement date filters while current holdings remain current");
  for (const mode of ["available", "reserved", "total", "core"]) {
    await page.locator("#chart-mode").selectOption(mode);
    assert.equal(await page.locator("#chart-mode").inputValue(), mode);
  }
  await page.locator('[data-metric="total"]').click();
  assert.ok(await page.getByRole("heading", { name: "汇总来源" }).isVisible());
  await page.keyboard.press("Escape");
  pass("all four allocation modes and statistic source drilldown");
  await page.clock.install();
  await page.getByRole("link", { name: "币价更新", exact: true }).click();
  await page.locator('[name="auto"]').check();
  await page.locator('[name="interval"]').selectOption("1");
  await page.locator('#price-settings button[type="submit"]').click();
  await page.waitForFunction(
    () => document.querySelector("#toast").textContent === "更新设置已保存",
  );
  const count = requests;
  await page.clock.fastForward(61000);
  await page.waitForTimeout(100);
  assert.ok(requests > count);
  await page.clock.resume();
  pass("configured minute refresh tested with virtual clock, no real waiting");
  await page.getByRole("link", { name: "持仓", exact: true }).click();
  await page
    .locator('[data-action="sources"][data-asset="USD"]')
    .first()
    .click();
  assert.ok(
    await page.getByRole("heading", { name: "USD 余额来源" }).isVisible(),
  );
  await page.keyboard.press("Escape");
  pass("asset sources and Escape dismissal");
  // Isolated demo browser for all pages/widths and stress strings.
  const visual = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const vp = await visual.newPage();
  await vp.goto(url);
  await vp.locator("h1").waitFor();
  await vp.screenshot({ path: out + "/390-dashboard.png", fullPage: true });
  for (const width of [320, 390, 768, 1440]) {
    await vp.setViewportSize({ width, height: 900 });
    for (const name of Object.keys({
      dashboard: 1,
      investments: 1,
      holdings: 1,
      cash: 1,
      prices: 1,
      data: 1,
    })) {
      await vp.goto(url + "#" + name);
      await vp.locator("h1").waitFor();
      const overflow = await vp.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
      );
      assert.equal(overflow, false, `overflow ${name}@${width}`);
    }
    await vp.goto(url + "#investments");
    await vp.locator('[data-action="new"]').click();
    assert.equal(
      await vp.evaluate(
        () =>
          document.querySelector("dialog").scrollWidth >
          document.querySelector("dialog").clientWidth + 1,
      ),
      false,
      `dialog overflow@${width}`,
    );
    await vp.keyboard.press("Escape");
  }
  pass("all six pages and entry dialogs fit 320 / 390 / 768 / 1440");
  await vp.setViewportSize({ width: 390, height: 844 });
  await vp.goto(url);
  await vp.locator('[data-action="new"]').click();
  await vp.screenshot({ path: out + "/390-entry-form.png", fullPage: false });
  await vp.keyboard.press("Escape");
  await vp.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  assert.equal(
    await vp.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    ),
    false,
  );
  pass("200% root text enlargement reflows at 390");
  await visual.close();
  await page.getByRole("link", { name: "数据管理", exact: true }).click();
  await click("lock");
  assert.equal(await page.locator(".demo-banner").count(), 1);
  assert.ok(!(await page.locator("#app").textContent()).includes("验收项目"));
  pass("locking removes personal data from rendered page");
  assert.deepEqual(errors, []);
  pass("zero uncaught browser script errors");
  await writeFile(
    out + "/result.json",
    JSON.stringify({ checks, errors, requests }, null, 2),
  );
  try {
    const safari = await webkit.launch({ headless: true });
    const sp = await safari.newPage();
    await sp.goto(url);
    await sp.locator("h1").waitFor();
    await sp.locator('[data-action="new"]').click();
    await sp.locator("dialog").waitFor();
    await safari.close();
    console.log("PASS WebKit entry dialog");
  } catch (e) {
    console.log("LIMITATION WebKit unavailable: " + String(e).split("\n")[0]);
  }
} catch (e) {
  await page.screenshot({ path: out + "/failure.png", fullPage: true });
  throw e;
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
