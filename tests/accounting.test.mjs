import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyBook,
  blankInvestment,
  base,
  ASSETS,
} from "../dist/assets/model.js";
import { calculate } from "../dist/assets/engine.js";
import { dec, str, div } from "../dist/assets/decimal.js";
import { assertBook } from "../dist/assets/validate.js";
import { demoBook } from "../dist/assets/demo.js";
import {
  exportCSV,
  parseCSV,
  autoMapping,
  previewCSV,
} from "../dist/assets/csv.js";
import {
  mergeMarketPrices,
  refreshPrices,
  priceStatus,
} from "../dist/assets/prices.js";
const d = "2026-01-01";
function book() {
  const b = emptyBook();
  b.projects = [
    {
      id: "p",
      name: "虚构项目",
      category: "测试",
      account: "",
      related: null,
      notes: "",
      createdAt: d,
    },
  ];
  for (const a of ASSETS)
    b.prices[a] = {
      value: a === "ETH" ? "2000" : a === "SOL" ? "100" : "1",
      source: "manual",
      at: "2026-01-01T00:00:00Z",
      error: null,
    };
  return b;
}
const m = (asset, qty, price = "1") => ({ asset, qty, price });
const inv = (fields, date = d) => ({
  ...blankInvestment("p", date),
  ...fields,
});
const opening = (asset, qty) => ({
  ...base(d),
  kind: "opening",
  asset,
  qty,
  reason: "测试期初",
});
const deposit = (usdAmount = "1000", direction = "in") => ({
  ...base(d),
  kind: "cash",
  direction,
  fiat: "CNY",
  fiatAmount: str(dec(usdAmount) * 7n),
  usdAmount,
  rate: "7",
  fee: "0",
  payment: "USD",
  paymentAmount: usdAmount,
});
const eq = (actual, expected) => assert.equal(actual, dec(expected));

test("A: 入金只影响 USD 与净本金，项目利润为 0", () => {
  const b = book();
  b.entries = [deposit()];
  assertBook(b);
  const r = calculate(b);
  eq(r.holdings.USD.qty, "1000");
  eq(r.netDeposit, "1000");
  eq(r.realized, "0");
  eq(r.floating, "0");
});
test("B: 投入与未到账估值分离，不能用于支付", () => {
  const b = book();
  b.entries = [
    deposit(),
    inv({ cost: m("USD", "400"), valuation: { asset: "USD", qty: "450" } }),
  ];
  const r = calculate(b);
  eq(r.holdings.USD.qty, "600");
  eq(r.total, "1050");
  eq(r.available, "600");
  eq(r.floating, "50");
});
test("C: 全部结算清空估值、占用，历史估值不重复计入", () => {
  const b = book();
  b.entries = [
    deposit(),
    inv({ cost: m("USD", "400"), valuation: { asset: "USD", qty: "450" } }),
    inv(
      {
        recovery: m("USD", "500"),
        release: [{ asset: "USD", qty: "400" }],
        projectState: "closed",
      },
      "2026-01-02",
    ),
  ];
  assertBook(b);
  const r = calculate(b);
  eq(r.holdings.USD.qty, "1100");
  eq(r.total, "1100");
  eq(r.valuation, "0");
  eq(r.realized, "100");
  eq(r.floating, "0");
  assert.equal(r.projects[0].status, "closed");
});
test("D: 占用 2 ETH 保留总量 5，可用 3，解锁无利润", () => {
  const b = book();
  b.entries = [
    opening("ETH", "5"),
    inv({ reserve: { asset: "ETH", qty: "2" } }),
  ];
  let r = calculate(b);
  eq(r.holdings.ETH.qty, "5");
  eq(r.holdings.ETH.available, "3");
  eq(r.reserved, "4000");
  eq(r.total, "10000");
  b.entries.push(inv({ reserve: { asset: "ETH", qty: "0" } }, "2026-01-02"));
  r = calculate(b);
  eq(r.holdings.ETH.available, "5");
  eq(r.realized, "0");
  eq(r.floating, "0");
});
test("E: 部分退出只结转 500 成本，剩余 500，浮盈 50", () => {
  const b = book();
  b.entries = [
    opening("USD", "1000"),
    inv({ cost: m("USD", "1000"), valuation: { asset: "USD", qty: "1000" } }),
    inv(
      {
        recovery: m("USD", "600"),
        release: [{ asset: "USD", qty: "500" }],
        valuation: { asset: "USD", qty: "550" },
      },
      "2026-01-02",
    ),
  ];
  assertBook(b);
  let r = calculate(b);
  eq(r.realized, "100");
  eq(r.projects[0].basis, "500");
  eq(r.floating, "50");
  eq(r.holdings.USD.qty, "600");
  b.entries.push(
    inv(
      {
        recovery: m("USD", "650"),
        release: [{ asset: "USD", qty: "500" }],
        projectState: "closed",
      },
      "2026-01-03",
    ),
  );
  r = calculate(b);
  eq(r.realized, "250");
  eq(r.total, "1250");
  eq(r.projects[0].basis, "0");
});
test("F: 跨币种结算为 200 USD，以后 ETH 涨跌不改历史结果", () => {
  const b = book();
  b.entries = [
    opening("USD", "1000"),
    inv({ cost: m("USD", "1000") }),
    inv(
      {
        recovery: m("ETH", "0.6", "2000"),
        release: [{ asset: "USD", qty: "1000" }],
        projectState: "closed",
      },
      "2026-01-02",
    ),
  ];
  let r = calculate(b);
  eq(r.holdings.USD.qty, "0");
  eq(r.holdings.ETH.qty, "0.6");
  eq(r.realized, "200");
  b.prices.ETH.value = "3000";
  r = calculate(b);
  eq(r.realized, "200");
  eq(r.total, "1800");
  assert.equal(r.settlements[0].native, null);
});
test("G: 双边兑换原子记账，不计外部入金或项目利润", () => {
  const b = book();
  b.entries = [
    opening("USD", "1000"),
    {
      ...base(d),
      kind: "exchange",
      from: { asset: "USD", qty: "1000" },
      to: { asset: "ETH", qty: "0.5" },
      fee: null,
    },
  ];
  assertBook(b);
  const r = calculate(b);
  eq(r.holdings.USD.qty, "0");
  eq(r.holdings.ETH.qty, "0.5");
  eq(r.total, "1000");
  eq(r.netDeposit, "0");
  eq(r.realized, "0");
});
test("H: 修改、撤销、恢复全量重算，不重复扣款或回款", () => {
  const b = book();
  b.entries = [
    deposit(),
    inv({ cost: m("USD", "400"), valuation: { asset: "USD", qty: "450" } }),
    inv(
      {
        recovery: m("USD", "500"),
        release: [{ asset: "USD", qty: "400" }],
        projectState: "closed",
      },
      "2026-01-02",
    ),
  ];
  b.entries[2].recovery.qty = "600";
  eq(calculate(b).realized, "200");
  b.entries[2].deleted = true;
  let r = calculate(b);
  eq(r.holdings.USD.qty, "600");
  eq(r.valuation, "450");
  eq(r.realized, "0");
  assert.equal(r.projects[0].status, "active");
  b.entries[2].deleted = false;
  r = calculate(b);
  eq(r.holdings.USD.qty, "1200");
  eq(r.valuation, "0");
  eq(r.realized, "200");
  assert.deepEqual(r, calculate(b));
});
test("H: 请求失败、空价格、零价格、过期时间均保留上次成功价格", async () => {
  const b = book(),
    at = Date.now();
  let p = mergeMarketPrices(
    b.prices,
    {
      bitcoin: { usd: 0, last_updated_at: at / 1000 },
      ethereum: { usd: null, last_updated_at: at / 1000 },
      solana: { usd: 123, last_updated_at: 1 },
    },
    at,
  );
  for (const a of ASSETS) assert.equal(p[a].value, b.prices[a].value);
  assert.ok(p.BTC.error);
  p = await refreshPrices(b.prices, async () => {
    throw new Error("offline");
  });
  assert.equal(p.ETH.value, "2000");
  assert.equal(priceStatus(p.ETH, 1), "更新失败");
});
test("币本位收益 2 → 2.6 SOL 等于 0.6 SOL，历史 USD 单独计算", () => {
  const b = book();
  b.entries = [
    opening("SOL", "2"),
    inv({ cost: m("SOL", "2", "100") }),
    inv(
      {
        recovery: m("SOL", "2.6", "120"),
        release: [{ asset: "SOL", qty: "2" }],
        projectState: "closed",
      },
      "2026-01-02",
    ),
  ];
  const r = calculate(b);
  eq(r.realized, "112");
  assert.deepEqual(r.settlements[0].native, { asset: "SOL", qty: "0.6" });
});
test("成本手续费按比例结转，结算费即时扣一次，剩余尾差全额分配", () => {
  const b = book();
  b.entries = [
    opening("USD", "2000"),
    inv({
      cost: m("USD", "1000"),
      fee: m("USD", "10"),
      feeTreatment: "cost",
      valuation: { asset: "USD", qty: "1000" },
    }),
    inv(
      {
        recovery: m("USD", "600"),
        release: [{ asset: "USD", qty: "500" }],
        fee: m("USD", "2"),
        feeTreatment: "settlement",
        valuation: { asset: "USD", qty: "550" },
      },
      "2026-01-02",
    ),
  ];
  const r = calculate(b);
  eq(r.realized, "93");
  eq(r.projects[0].basis, "505");
  eq(r.floating, "45");
  eq(r.holdings.USD.qty, "1588");
  eq(r.total, "2138");
});
test("同币种 FIFO 成本按历史批次结转", () => {
  const b = book();
  b.entries = [
    opening("ETH", "3"),
    inv({ cost: m("ETH", "1", "1000") }),
    inv({ cost: m("ETH", "2", "2000") }, "2026-01-02"),
    inv(
      {
        recovery: m("USD", "4000"),
        release: [{ asset: "ETH", qty: "2" }],
        valuation: { asset: "USD", qty: "2500" },
      },
      "2026-01-03",
    ),
  ];
  const r = calculate(b);
  eq(r.realized, "1000");
  eq(r.projects[0].basis, "2000");
  eq(r.projects[0].remaining.ETH, "1");
});
test("未知估值与 0 估值不同，缺历史价格不能默认为 0", () => {
  const b = book();
  b.entries = [opening("ETH", "1"), inv({ cost: m("ETH", "1", null) })];
  let r = calculate(b);
  assert.equal(r.floating, null);
  assert.equal(r.total, null);
  assert.equal(r.projects[0].basis, null);
  b.entries[1].cost.price = "2000";
  b.entries[1].valuation = { asset: "USD", qty: "0" };
  r = calculate(b);
  eq(r.floating, "-2000");
  eq(r.total, "0");
  b.entries.push(
    inv(
      {
        recovery: m("SOL", "1", null),
        release: [{ asset: "ETH", qty: "1" }],
        projectState: "closed",
      },
      "2026-01-02",
    ),
  );
  assert.equal(calculate(b).realized, null);
});
test("无投入但明确未知的估值也保持未知，不默认为 0", () => {
  const b = book();
  b.entries = [inv({ valuation: { asset: "USD", qty: null } })];
  assert.equal(calculate(b).total, null);
});
test("结束仍有成本、超额结转、回款不更新估值都拒绝", () => {
  for (const fields of [
    { projectState: "closed" },
    {
      recovery: m("USD", "600"),
      release: [{ asset: "USD", qty: "1001" }],
      projectState: "closed",
    },
    { recovery: m("USD", "600"), release: [{ asset: "USD", qty: "1000" }] },
  ]) {
    const b = book();
    b.entries = [
      inv({ cost: m("USD", "1000"), valuation: { asset: "USD", qty: "550" } }),
      inv(fields, "2026-01-02"),
    ];
    assert.throws(() => assertBook(b));
  }
});
test("撤销被后续结算依赖的投入被拒绝，不产生静默错账", () => {
  const b = book();
  b.entries = [
    inv({ cost: m("USD", "1000") }),
    inv(
      {
        recovery: m("USD", "1100"),
        release: [{ asset: "USD", qty: "1000" }],
        projectState: "closed",
      },
      "2026-01-02",
    ),
  ];
  b.entries[0].deleted = true;
  assert.throws(() => assertBook(b), /结转超出/);
});
test("负可用余额带警示与完整来源；调整不计盈利", () => {
  const b = book();
  b.entries = [
    opening("ETH", "5"),
    inv({ reserve: { asset: "ETH", qty: "6" } }),
    { ...base(d), kind: "adjustment", asset: "USD", qty: "-1", reason: "更正" },
  ];
  const r = calculate(b);
  assert.ok(r.issues.some((i) => i.asset === "ETH"));
  assert.ok(r.issues.some((i) => i.asset === "USD"));
  eq(r.holdings.ETH.available, "-1");
  eq(r.realized, "0");
  eq(r.netDeposit, "0");
  assert.equal(r.holdings.USD.sources.length, 1);
});
test("结算和入金按发生日期筛选，当前余额与估值始终为当前", () => {
  const b = book();
  b.entries = [
    deposit(),
    inv({ cost: m("USD", "400") }),
    inv(
      {
        recovery: m("USD", "500"),
        release: [{ asset: "USD", qty: "400" }],
        projectState: "closed",
      },
      "2026-02-01",
    ),
  ];
  const r = calculate(b, { start: "2026-01-01", end: "2026-01-31" });
  eq(r.realized, "0");
  eq(r.netDeposit, "1000");
  eq(r.total, "1100");
});
test("18 位小数精确相加，分配的末次成本不遗失", () => {
  assert.equal(str(dec("0.1") + dec("0.2")), "0.3");
  assert.equal(str(dec("0.000000000000000001")), "0.000000000000000001");
  const b = book();
  b.entries = [
    opening("USD", "1"),
    inv({ cost: m("SOL", "3", "0.333333333333333333") }),
    ...[1, 2, 3].map((n) =>
      inv(
        {
          recovery: m("USD", "1"),
          release: [{ asset: "SOL", qty: "1" }],
          valuation: { asset: "USD", qty: "0" },
          projectState: n === 3 ? "closed" : null,
        },
        `2026-01-0${n + 1}`,
      ),
    ),
  ];
  eq(calculate(b).projects[0].basis, "0");
  eq(calculate(b).realized, "2.000000000000000001");
});
test("CNY/HKD 分离保存；出入金手续费只扣余额，不改净本金", () => {
  const b = book();
  b.entries = [
    { ...deposit(), fee: "10" },
    {
      ...deposit("200", "out"),
      fiat: "HKD",
      fiatAmount: "1560",
      rate: "7.8",
      fee: "2",
    },
  ];
  assertBook(b);
  const r = calculate(b);
  eq(r.netDeposit, "800");
  eq(r.holdings.USD.qty, "788");
  eq(r.cashFees, "12");
  eq(r.realized, "0");
});
test("CSV 导出导入全类型往返，重复导入不双记", () => {
  const b = demoBook();
  b.entries.push({
    ...base(d),
    kind: "exchange",
    from: { asset: "USD", qty: "10" },
    to: { asset: "BTC", qty: "0.0001" },
    fee: { asset: "USD", qty: "1" },
  });
  const rows = parseCSV(exportCSV(b));
  const result = previewCSV(rows, autoMapping(rows[0]), emptyBook());
  assert.deepEqual(result.errors, []);
  assert.equal(result.added, b.entries.length);
  for (const a of ASSETS)
    assert.equal(
      calculate(result.book).holdings[a].qty,
      calculate(b).holdings[a].qty,
    );
  const again = previewCSV(rows, autoMapping(rows[0]), result.book);
  assert.deepEqual(again.errors, []);
  assert.equal(again.added, 0);
  assert.equal(again.duplicates, b.entries.length);
});
test("CSV 字段映射、中文引号换行、坏数据阻止导入", () => {
  const text =
    '日期列,名称,花费,市值,备注\n2026-01-01,项目A,400,450,"带逗号,与\n换行"';
  const rows = parseCSV(text);
  const mapping = {
    date: "日期列",
    project: "名称",
    costQty: "花费",
    valuationQty: "市值",
    note: "备注",
  };
  const result = previewCSV(rows, mapping, emptyBook());
  assert.deepEqual(result.errors, []);
  eq(calculate(result.book).floating, "50");
  assert.ok(result.book.entries[0].note.includes("\n"));
  assert.throws(() => parseCSV("a,a\n1,2"), /重复/);
  assert.throws(() => parseCSV('a,b\n1,"2'), /闭合/);
  const bad = previewCSV(
    parseCSV("日期,项目名称,成本数量\n2026-13-01,A,abc"),
    { date: "日期", project: "项目名称", costQty: "成本数量" },
    emptyBook(),
  );
  assert.ok(bad.errors.length);
});
test("坏汇率、币种、结构和无效真实日期拒绝", () => {
  const b = book();
  b.entries = [deposit()];
  b.entries[0].rate = "0";
  assert.throws(() => assertBook(b), /汇率/);
  b.entries[0] = deposit();
  b.entries[0].date = "2026-02-30";
  assert.throws(() => assertBook(b), /日期/);
  b.entries[0] = opening("DOGE", "10");
  assert.throws(() => assertBook(b), /币种/);
});
test("随机 250 组部分结转：回款只计一次、余额守恒、成本不重复", () => {
  let seed = 17;
  const next = () => {
    seed = (seed * 48271) % 2147483647;
    return seed;
  };
  for (let i = 0; i < 250; i++) {
    const investment = 1000 + (next() % 10000);
    const part = 1 + (next() % (investment - 1));
    const rec1 = next() % 10000,
      rec2 = next() % 10000;
    const b = book();
    b.entries = [
      opening("USD", String(investment)),
      inv({ cost: m("USD", String(investment)) }),
      inv(
        {
          recovery: rec1 ? m("USD", String(rec1)) : null,
          release: [{ asset: "USD", qty: String(part) }],
          valuation: { asset: "USD", qty: "0" },
        },
        "2026-01-02",
      ),
      inv(
        {
          recovery: rec2 ? m("USD", String(rec2)) : null,
          release: [{ asset: "USD", qty: String(investment - part) }],
          projectState: "closed",
        },
        "2026-01-03",
      ),
    ];
    assertBook(b);
    const r = calculate(b);
    eq(r.holdings.USD.qty, String(rec1 + rec2));
    eq(r.realized, String(rec1 + rec2 - investment));
    eq(r.projects[0].basis, "0");
  }
});

test("CSV 防公式转义可逆，不丢失名称和备注，也不影响去重", () => {
  const b = book();
  b.projects[0].name = "=虚构公式项目";
  b.entries = [
    inv({
      cost: m("USD", "10"),
      valuation: { asset: "USD", qty: "10" },
      note: "+文本而非公式",
      account: "'=原有单引号",
    }),
  ];
  const csv = exportCSV(b);
  assert.ok(csv.includes("'=虚构公式项目"));
  const rows = parseCSV(csv);
  const result = previewCSV(rows, autoMapping(rows[0]), b);
  assert.deepEqual(result.errors, []);
  assert.equal(result.added, 0);
  assert.equal(result.duplicates, 1);
});
test("未来实际流水拒绝，USD 显示使用整数舍入避免大额丢失分位", async () => {
  const b = book();
  b.entries = [{ ...opening("USD", "1000"), date: "2099-01-01" }];
  assert.throws(() => assertBook(b), /未来/);
  const { usd } = await import("../dist/assets/ui.js");
  assert.equal(usd(dec("999999999999999.99")), "$999,999,999,999,999.99");
  assert.equal(usd(dec("0.005")), "$0.01");
});

test("CSV 出入金不猜方向和法币，拒绝混淆手续费币种，预览显示真实金额", () => {
  const source =
    "类型,日期,出入金方向,法币类型,法币金额,对应USD金额,手续费币种,手续费数量\n出入金,2026-01-01,in,CNY,7000,1000,USD,1";
  const rows = parseCSV(source);
  const good = previewCSV(rows, autoMapping(rows[0]), emptyBook());
  assert.deepEqual(good.errors, []);
  assert.ok(good.preview[0].amount.includes("7000 CNY"));
  assert.ok(good.preview[0].amount.includes("+1000 USD"));
  for (const bad of [
    source.replace(",in,CNY,", ",,CNY,"),
    source.replace(",USD,1", ",ETH,1"),
  ]) {
    const data = parseCSV(bad);
    assert.ok(
      previewCSV(data, autoMapping(data[0]), emptyBook()).errors.length,
    );
  }
});
