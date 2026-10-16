import { ASSETS, type Asset, type Book, type Entry } from "./model.js";
import type { Result } from "./engine.js";
import { str } from "./decimal.js";
export type Page =
  | "dashboard"
  | "investments"
  | "holdings"
  | "cash"
  | "prices"
  | "data";
export type Filters = {
  search: string;
  project: string;
  category: string;
  status: string;
  asset: string;
  account: string;
  start: string;
  end: string;
  sort: string;
  deleted: boolean;
};
export const defaultFilters = (): Filters => ({
  search: "",
  project: "",
  category: "",
  status: "",
  asset: "",
  account: "",
  start: "",
  end: "",
  sort: "newest",
  deleted: false,
});
export type ViewState = {
  book: Book;
  result: Result;
  page: Page;
  demo: boolean;
  locked: boolean;
  hasVault: boolean;
  filters: Filters;
  range: { start: string; end: string };
  chart: string;
  refreshing: boolean;
  savedAt: string;
  storageError: string;
};
export const esc = (s: unknown): string =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const icons: Record<string, string> = {
  dashboard:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  investments:
    '<path d="M8 3h10a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2v18M9 8h7M9 12h7M9 16h4"/>',
  holdings:
    '<path d="M3 7h16a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2V7zm0 0V5a2 2 0 0 1 2-2h13v4m-2 5h5v4h-5z"/>',
  cash: '<path d="M7 3v17m-4-4 4 4 4-4M17 21V4m-4 4 4-4 4 4"/>',
  prices: '<path d="m3 17 6-6 4 3 8-10M15 4h6v6M3 21h18"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5m10-4a8 8 0 0 0-14-2m0 10a8 8 0 0 0 14 2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 13h6m-6 4h6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
};
export const icon = (name: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.info}</svg>`;
export const btn = (
  label: string,
  action: string,
  cls = "",
  extra = "",
): string =>
  `<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${label}</button>`;
export const empty = (
  title: string,
  desc: string,
  action = "new",
  label = "记第一笔",
): string =>
  `<div class="empty-state">${icon("file")}<h3>${esc(title)}</h3><p>${esc(desc)}</p>${btn(label, action, "secondary")}</div>`;
export function usd(n: bigint | null, signed = false): string {
  if (n === null) return "待补充";
  const absolute = n < 0n ? -n : n;
  const cents = (absolute + 5n * 10n ** 15n) / 10n ** 16n;
  const sign = cents === 0n ? "" : n < 0n ? "−" : signed ? "+" : "";
  return `${sign}$${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")}`;
}
export const qty = (n: bigint | string): string =>
  typeof n === "bigint" ? str(n) : n;
export const pnlClass = (n: bigint | null): string =>
  n === null ? "muted" : n < 0n ? "negative" : n > 0n ? "positive" : "";
export const assetName: Record<Asset, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  BNB: "BNB",
  SOL: "Solana",
  USD: "美元账户",
};
export const colors: Record<Asset, string> = {
  BTC: "#c18b3d",
  ETH: "#6a7ea9",
  BNB: "#c6ac4e",
  SOL: "#7b8b75",
  USD: "#a8bbb0",
};
export const coin = (a: Asset): string =>
  `<span class="coin coin-${a}" aria-hidden="true">${{ BTC: "₿", ETH: "Ξ", BNB: "◇", SOL: "≋", USD: "$" }[a]}</span>`;
export const dateLabel = (date: string | null): string =>
  date ? esc(date.replaceAll("-", ".")) : "暂无";
export const entryName = (e: Entry, book: Book): string =>
  e.kind === "investment"
    ? (book.projects.find((p) => p.id === e.projectId)?.name ?? "未知项目")
    : e.kind === "cash"
      ? `${e.direction === "in" ? "法币入金" : "法币出金"} · ${e.fiat}`
      : e.kind === "exchange"
        ? `${e.from.asset} → ${e.to.asset}`
        : e.kind === "opening"
          ? "期初余额"
          : "余额调整";
export const entryType = (e: Entry): string =>
  e.kind === "investment"
    ? e.projectState === "closed"
      ? "结算结束"
      : e.recovery
        ? "实际回款"
        : e.cost
          ? "实际投入"
          : e.reserve
            ? "占用更新"
            : e.valuation
              ? "估值更新"
              : "状态更新"
    : e.kind === "cash"
      ? "法币出入金"
      : e.kind === "exchange"
        ? "核心兑换"
        : e.kind === "opening"
          ? "期初余额"
          : "余额调整";
export function entryAmount(e: Entry): string {
  if (e.kind === "investment")
    return (
      [
        e.cost ? `−${e.cost.qty} ${e.cost.asset}` : "",
        e.recovery ? `+${e.recovery.qty} ${e.recovery.asset}` : "",
        !e.cost && !e.recovery && e.reserve
          ? `占用 ${e.reserve.qty} ${e.reserve.asset}`
          : "",
        !e.cost && !e.recovery && !e.reserve && e.valuation
          ? `估值 ${e.valuation.qty ?? "未知"} ${e.valuation.asset}`
          : "",
        e.fee ? `费用 ${e.fee.qty} ${e.fee.asset}` : "",
      ]
        .filter(Boolean)
        .join(" / ") || "仅结转 / 状态"
    );
  if (e.kind === "cash")
    return `${e.direction === "in" ? "+" : "−"}${e.usdAmount} USD${e.fee !== "0" ? ` / 费用 ${e.fee}` : ""}`;
  if (e.kind === "exchange")
    return `${e.from.qty} ${e.from.asset} → ${e.to.qty} ${e.to.asset}`;
  return `${e.qty} ${e.asset}`;
}
export const assetsOf = (e: Entry): Asset[] =>
  e.kind === "investment"
    ? [
        e.cost?.asset,
        e.recovery?.asset,
        e.fee?.asset,
        e.reserve?.asset,
        e.valuation?.asset,
        ...e.release.map((r) => r.asset),
      ].filter((a): a is Asset => !!a)
    : e.kind === "cash"
      ? ["USD"]
      : e.kind === "exchange"
        ? [e.from.asset, e.to.asset, ...(e.fee ? [e.fee.asset] : [])]
        : [e.asset];
export const option = (
  value: string,
  label: string,
  selected: string,
): string =>
  `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`;
export const assetOptions = (selected = "USD"): string =>
  ASSETS.map((a) => option(a, a, selected)).join("");
export function field(
  label: string,
  name: string,
  value = "",
  type = "text",
  extra = "",
): string {
  return `<label class="field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}/></label>`;
}
export const select = (
  label: string,
  name: string,
  options: string,
  extra = "",
): string =>
  `<label class="field"><span>${esc(label)}</span><select name="${name}" ${extra}>${options}</select></label>`;
export const checkbox = (
  label: string,
  name: string,
  checked = false,
  extra = "",
): string =>
  `<label class="check-label"><input type="checkbox" name="${name}" ${checked ? "checked" : ""} ${extra}/><span>${esc(label)}</span></label>`;
export const amountField = (
  label: string,
  name: string,
  value = "",
  extra = "",
): string =>
  field(
    label,
    name,
    value,
    "text",
    `inputmode="decimal" autocomplete="off" maxlength="50" ${extra}`,
  );
export const formError = (): string =>
  '<div class="form-error" id="form-error" role="alert" tabindex="-1" hidden></div>';
export const dialogHead = (title: string, sub = ""): string =>
  `<div class="dialog-head"><div><h2 id="dialog-title">${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${btn(icon("close"), "close", "icon-button", 'aria-label="关闭对话框"')}</div>`;
export const formEnd = (label = "保存记录"): string =>
  `${formError()}<div class="dialog-actions">${btn("取消", "close", "secondary")}<button class="btn primary" type="submit">${icon("check")}${esc(label)}</button></div>`;
