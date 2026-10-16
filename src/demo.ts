import {
  base,
  blankInvestment,
  emptyBook,
  type Asset,
  type Book,
  type Project,
} from "./model.js";
export function demoBook(): Book {
  const b = emptyBook();
  b.id = "demo-book";
  b.name = "演示投资账本";
  b.settings.auto = false;
  const prices: Record<Asset, string> = {
    BTC: "67420",
    ETH: "2640",
    BNB: "588",
    SOL: "156.8",
    USD: "1",
  };
  for (const a of Object.keys(prices) as Asset[])
    b.prices[a] = {
      value: prices[a],
      at: "2026-10-15T08:00:00.000Z",
      source: "demo",
      error: null,
    };
  const p = (
    pid: string,
    name: string,
    category: string,
    account: string,
  ): Project => ({
    id: pid,
    name,
    category,
    account,
    notes: "此项目为虚构演示，仅用于体验账务流程。",
    related: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  b.projects = [
    p("p1", "Solana 生态探索", "生态投资", "主账户"),
    p("p2", "ETH 节点计划", "质押 / 锁仓", "冷钱包"),
    p("p3", "数字艺术收藏", "NFT", "主账户"),
    p("p4", "新项目认购", "打新", "交易账户"),
  ];
  b.entries = [
    ...(["BTC", "ETH", "BNB", "SOL"] as Asset[]).map((asset, i) => ({
      ...base("2026-09-01"),
      id: `open-${asset}`,
      kind: "opening" as const,
      asset,
      qty: ["0.18", "4.5", "6", "42"][i],
      reason: "演示期初余额",
      account: "主账户",
    })),
    {
      ...base("2026-09-03"),
      id: "cash1",
      kind: "cash",
      direction: "in",
      fiat: "CNY",
      fiatAmount: "71000",
      usdAmount: "10000",
      rate: "7.1",
      fee: "0",
      payment: "USD",
      paymentAmount: "10000",
      note: "虚构法币入金",
    },
    {
      ...blankInvestment("p1", "2026-09-10"),
      id: "i1",
      cost: { asset: "SOL", qty: "12", price: "140" },
      valuation: { asset: "SOL", qty: "14.2" },
    },
    {
      ...blankInvestment("p1", "2026-10-06"),
      id: "i2",
      recovery: { asset: "SOL", qty: "7.2", price: "150" },
      release: [{ asset: "SOL", qty: "6" }],
      valuation: { asset: "SOL", qty: "7.8" },
      feeTreatment: "settlement",
    },
    {
      ...blankInvestment("p2", "2026-09-15"),
      id: "i3",
      reserve: { asset: "ETH", qty: "2" },
    },
    {
      ...blankInvestment("p3", "2026-09-18"),
      id: "i4",
      cost: { asset: "ETH", qty: "0.5", price: "2500" },
      valuation: { asset: "USD", qty: "980" },
    },
    {
      ...blankInvestment("p4", "2026-10-01"),
      id: "i5",
      cost: { asset: "USD", qty: "1800", price: "1" },
      valuation: { asset: "USD", qty: "1800" },
    },
    {
      ...blankInvestment("p4", "2026-10-12"),
      id: "i6",
      recovery: { asset: "USD", qty: "2160", price: "1" },
      release: [{ asset: "USD", qty: "1800" }],
      projectState: "closed",
      feeTreatment: "settlement",
    },
  ];
  return b;
}
