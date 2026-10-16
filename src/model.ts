export const ASSETS = ["BTC", "ETH", "BNB", "SOL", "USD"] as const;
export type Asset = (typeof ASSETS)[number];
export type Money = { asset: Asset; qty: string };
export type HistoricalMoney = Money & { price: string | null };
export type Valuation = { asset: Asset; qty: string | null };
export type Project = {
  id: string;
  name: string;
  category: string;
  account: string;
  related: string | null;
  notes: string;
  createdAt: string;
};
export type BaseEntry = {
  id: string;
  date: string;
  createdAt: string;
  account: string;
  note: string;
  deleted: boolean;
};
export type Investment = BaseEntry & {
  kind: "investment";
  projectId: string;
  cost: HistoricalMoney | null;
  recovery: HistoricalMoney | null;
  release: Money[];
  fee: HistoricalMoney | null;
  feeTreatment: "cost" | "settlement";
  reserve: Money | null;
  valuation: Valuation | null;
  projectState: "active" | "closed" | null;
};
export type CashEntry = BaseEntry & {
  kind: "cash";
  direction: "in" | "out";
  fiat: "CNY" | "HKD";
  fiatAmount: string;
  usdAmount: string;
  rate: string;
  fee: string;
  payment: "USD" | "USDT" | "USDC";
  paymentAmount: string;
};
export type ExchangeEntry = BaseEntry & {
  kind: "exchange";
  from: Money;
  to: Money;
  fee: Money | null;
};
export type AdjustmentEntry = BaseEntry & {
  kind: "opening" | "adjustment";
  asset: Asset;
  qty: string;
  reason: string;
};
export type Entry = Investment | CashEntry | ExchangeEntry | AdjustmentEntry;
export type Price = {
  value: string | null;
  at: string | null;
  source: "market" | "manual" | "demo" | "missing";
  error: string | null;
};
export type Audit = {
  at: string;
  action: string;
  entityId: string;
  before: Entry | Project | null;
  after: Entry | Project | null;
};
export type Book = {
  schema: 1;
  id: string;
  name: string;
  revision: number;
  projects: Project[];
  entries: Entry[];
  prices: Record<Asset, Price>;
  settings: { interval: number; auto: boolean };
  audit: Audit[];
};
export function id(): string {
  return crypto.randomUUID();
}
export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const base = (date = today()): BaseEntry => ({
  id: id(),
  date,
  createdAt: new Date().toISOString(),
  account: "",
  note: "",
  deleted: false,
});
export function emptyBook(): Book {
  return {
    schema: 1,
    id: id(),
    name: "我的投资账本",
    revision: 0,
    projects: [],
    entries: [],
    prices: Object.fromEntries(
      ASSETS.map((a) => [
        a,
        {
          value: a === "USD" ? "1" : null,
          at: null,
          source: a === "USD" ? "manual" : "missing",
          error: null,
        },
      ]),
    ) as Record<Asset, Price>,
    settings: { interval: 5, auto: true },
    audit: [],
  };
}
export function blankInvestment(projectId = "", date = today()): Investment {
  return {
    ...base(date),
    kind: "investment",
    projectId,
    cost: null,
    recovery: null,
    release: [],
    fee: null,
    feeTreatment: "cost",
    reserve: null,
    valuation: null,
    projectState: null,
  };
}
