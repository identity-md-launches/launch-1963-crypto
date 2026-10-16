import {
  ASSETS,
  type Asset,
  type Book,
  type Entry,
  type Investment,
  type Money,
  type Project,
  type Valuation,
} from "./model.js";
import { amountUSD, dec, mul, nullableSum, str } from "./decimal.js";
export type Lot = {
  entryId: string;
  asset: Asset;
  remaining: bigint;
  usd: bigint | null;
  nativeFee: bigint | null;
};
export type Settlement = {
  entryId: string;
  projectId: string;
  date: string;
  asset: Asset;
  recoveryUSD: bigint | null;
  costUSD: bigint | null;
  feeUSD: bigint | null;
  pnl: bigint | null;
  native: Money | null;
};
export type ProjectResult = {
  project: Project;
  status: "active" | "closed";
  start: string | null;
  end: string | null;
  entries: Investment[];
  lots: Lot[];
  reserve: Money | null;
  valuation: Valuation | null;
  remaining: Record<Asset, bigint>;
  basis: bigint | null;
  valuationUSD: bigint | null;
  floating: bigint | null;
  realized: bigint | null;
  settlements: Settlement[];
};
export type Source = {
  entryId: string;
  date: string;
  label: string;
  delta: bigint;
  kind: string;
  projectId?: string;
};
export type Holding = {
  asset: Asset;
  qty: bigint;
  reserved: bigint;
  available: bigint;
  price: string | null;
  value: bigint | null;
  availableValue: bigint | null;
  reserveValue: bigint | null;
  projectValue: bigint | null;
  realized: bigint | null;
  floating: bigint | null;
  sources: Source[];
};
export type Issue = {
  severity: "error" | "warning";
  message: string;
  entryId?: string;
  projectId?: string;
  asset?: Asset;
};
export type Result = {
  holdings: Record<Asset, Holding>;
  projects: ProjectResult[];
  settlements: Settlement[];
  issues: Issue[];
  core: bigint | null;
  available: bigint | null;
  reserved: bigint | null;
  valuation: bigint | null;
  total: bigint | null;
  realized: bigint | null;
  floating: bigint | null;
  netDeposit: bigint;
  deposits: bigint;
  withdrawals: bigint;
  cashFees: bigint;
};
const zeroes = (): Record<Asset, bigint> =>
  Object.fromEntries(ASSETS.map((a) => [a, 0n])) as Record<Asset, bigint>;
export const inRange = (date: string, start: string, end: string): boolean =>
  (!start || date >= start) && (!end || date <= end);
export function calculate(
  book: Book,
  range: { start: string; end: string } = { start: "", end: "" },
): Result {
  const issues: Issue[] = [];
  const holdings = Object.fromEntries(
    ASSETS.map((asset) => [
      asset,
      {
        asset,
        qty: 0n,
        reserved: 0n,
        available: 0n,
        price: asset === "USD" ? "1" : book.prices[asset].value,
        value: 0n,
        availableValue: 0n,
        reserveValue: 0n,
        projectValue: 0n,
        realized: 0n,
        floating: 0n,
        sources: [] as Source[],
      },
    ]),
  ) as Record<Asset, Holding>;
  const projects: ProjectResult[] = book.projects.map((project) => ({
    project,
    status: "active",
    start: null,
    end: null,
    entries: [],
    lots: [],
    reserve: null,
    valuation: null,
    remaining: zeroes(),
    basis: 0n,
    valuationUSD: 0n,
    floating: 0n,
    realized: 0n,
    settlements: [],
  }));
  const byId = new Map(projects.map((p) => [p.project.id, p]));
  const settlements: Settlement[] = [];
  let netDeposit = 0n,
    deposits = 0n,
    withdrawals = 0n,
    cashFees = 0n;
  const apply = (
    asset: Asset,
    delta: bigint,
    entry: Entry,
    label: string,
    projectId?: string,
  ) => {
    holdings[asset].qty += delta;
    if (delta !== 0n)
      holdings[asset].sources.push({
        entryId: entry.id,
        date: entry.date,
        label,
        delta,
        kind: entry.kind,
        projectId,
      });
  };
  const sorted = book.entries
    .filter((e) => !e.deleted)
    .map((e, order) => ({ e, order }))
    .sort(
      (a, b) =>
        a.e.date.localeCompare(b.e.date) ||
        a.e.createdAt.localeCompare(b.e.createdAt) ||
        a.order - b.order,
    )
    .map((x) => x.e);
  for (const e of sorted) {
    if (e.kind === "cash") {
      const sign = e.direction === "in" ? 1n : -1n;
      apply(
        "USD",
        sign * dec(e.usdAmount) - dec(e.fee),
        e,
        `${e.direction === "in" ? "法币入金" : "法币出金"} · ${e.fiat}`,
      );
      if (inRange(e.date, range.start, range.end)) {
        if (e.direction === "in") deposits += dec(e.usdAmount);
        else withdrawals += dec(e.usdAmount);
        netDeposit += sign * dec(e.usdAmount);
        cashFees += dec(e.fee);
      }
    } else if (e.kind === "opening" || e.kind === "adjustment") {
      apply(
        e.asset,
        dec(e.qty),
        e,
        `${e.kind === "opening" ? "期初余额" : "余额调整"} · ${e.reason}`,
      );
    } else if (e.kind === "exchange") {
      apply(e.from.asset, -dec(e.from.qty), e, `兑换转出 → ${e.to.asset}`);
      apply(e.to.asset, dec(e.to.qty), e, `兑换转入 ← ${e.from.asset}`);
      if (e.fee) apply(e.fee.asset, -dec(e.fee.qty), e, "兑换额外手续费");
    } else if (e.kind === "investment") {
      const p = byId.get(e.projectId);
      if (!p) {
        issues.push({
          severity: "error",
          message: "流水关联的项目不存在",
          entryId: e.id,
        });
        continue;
      }
      if (p.status === "closed" && e.projectState !== "active") {
        issues.push({
          severity: "error",
          message: `${p.project.name}：已结束项目须先选“重新进行”再追加流水`,
          projectId: e.projectId,
          entryId: e.id,
        });
      }
      p.entries.push(e);
      p.start ??= e.date;
      if (e.projectState === "active") {
        p.status = "active";
        p.end = null;
      }
      const feeUSD = e.fee ? amountUSD(e.fee.qty, e.fee.price) : 0n;
      if (e.cost) {
        apply(
          e.cost.asset,
          -dec(e.cost.qty),
          e,
          `${p.project.name} · 实际投入`,
          e.projectId,
        );
        const costUSD = amountUSD(e.cost.qty, e.cost.price);
        p.lots.push({
          entryId: e.id,
          asset: e.cost.asset,
          remaining: dec(e.cost.qty),
          usd: nullableSum([costUSD, e.feeTreatment === "cost" ? feeUSD : 0n]),
          nativeFee:
            e.feeTreatment === "cost" && e.fee
              ? e.fee.asset === e.cost.asset
                ? dec(e.fee.qty)
                : null
              : 0n,
        });
      }
      if (e.recovery)
        apply(
          e.recovery.asset,
          dec(e.recovery.qty),
          e,
          `${p.project.name} · 实际回收`,
          e.projectId,
        );
      if (e.fee)
        apply(
          e.fee.asset,
          -dec(e.fee.qty),
          e,
          `${p.project.name} · 额外手续费`,
          e.projectId,
        );
      const releasedValues: (bigint | null)[] = [];
      let nativeFees: bigint | null = 0n;
      for (const release of e.release) {
        let remaining = dec(release.qty);
        for (const lot of p.lots.filter(
          (l) => l.asset === release.asset && l.remaining > 0n,
        )) {
          if (remaining <= 0n) break;
          const used = remaining < lot.remaining ? remaining : lot.remaining;
          const basis =
            lot.usd === null
              ? null
              : used === lot.remaining
                ? lot.usd
                : (lot.usd * used) / lot.remaining;
          const feePart =
            lot.nativeFee === null
              ? null
              : used === lot.remaining
                ? lot.nativeFee
                : (lot.nativeFee * used) / lot.remaining;
          releasedValues.push(basis);
          nativeFees = nullableSum([nativeFees, feePart]);
          if (lot.usd !== null && basis !== null) lot.usd -= basis;
          if (lot.nativeFee !== null && feePart !== null)
            lot.nativeFee -= feePart;
          lot.remaining -= used;
          remaining -= used;
        }
        if (remaining > 0n)
          issues.push({
            severity: "error",
            message: `${p.project.name}：${release.asset} 本次结转超出剩余成本 ${str(remaining)}`,
            entryId: e.id,
            projectId: e.projectId,
          });
      }
      const settlementFee = e.feeTreatment === "settlement" ? feeUSD : 0n;
      if (
        e.recovery ||
        e.release.length ||
        (e.fee && e.feeTreatment === "settlement")
      ) {
        const recoveryUSD = e.recovery
          ? amountUSD(e.recovery.qty, e.recovery.price)
          : 0n;
        const costUSD = nullableSum(releasedValues);
        const asset =
          e.recovery?.asset ?? e.release[0]?.asset ?? e.fee?.asset ?? "USD";
        const nativeSame =
          e.release.every((r) => r.asset === asset) &&
          (!e.fee || e.feeTreatment === "cost" || e.fee.asset === asset) &&
          nativeFees !== null;
        const s: Settlement = {
          entryId: e.id,
          projectId: e.projectId,
          date: e.date,
          asset,
          recoveryUSD,
          costUSD,
          feeUSD: settlementFee,
          pnl:
            recoveryUSD === null || costUSD === null || settlementFee === null
              ? null
              : recoveryUSD - costUSD - settlementFee,
          native: nativeSame
            ? {
                asset,
                qty: str(
                  (e.recovery ? dec(e.recovery.qty) : 0n) -
                    e.release.reduce((sum, r) => sum + dec(r.qty), 0n) -
                    (nativeFees ?? 0n) -
                    (e.fee && e.feeTreatment === "settlement"
                      ? dec(e.fee.qty)
                      : 0n),
                ),
              }
            : null,
        };
        settlements.push(s);
        p.settlements.push(s);
        if (s.pnl === null)
          issues.push({
            severity: "warning",
            message: `${p.project.name}：历史成本、回款或费用价格待补充`,
            entryId: e.id,
            projectId: e.projectId,
          });
      }
      if (e.reserve) p.reserve = e.reserve;
      if (e.valuation) p.valuation = e.valuation;
      if (e.recovery && !e.valuation && e.projectState !== "closed") {
        issues.push({
          severity: "error",
          message: `${p.project.name}：回款后须更新剩余估值（可填未知或 0），避免回款重复计入估值`,
          entryId: e.id,
          projectId: e.projectId,
        });
      }
      if (e.projectState === "closed") {
        p.status = "closed";
        p.end = e.date;
        if (p.lots.some((l) => l.remaining > 0n))
          issues.push({
            severity: "error",
            message: `${p.project.name}：仍有未结转成本，请填写本次结转或确认损失结转`,
            entryId: e.id,
            projectId: e.projectId,
          });
        p.reserve = null;
        p.valuation = { asset: "USD", qty: "0" };
      }
    }
  }
  for (const p of projects) {
    for (const lot of p.lots) p.remaining[lot.asset] += lot.remaining;
    p.basis = nullableSum(
      p.lots.filter((l) => l.remaining > 0n).map((l) => l.usd),
    );
    const hasCost = p.lots.some((l) => l.remaining > 0n);
    p.valuationUSD =
      p.status === "closed"
        ? 0n
        : p.valuation
          ? p.valuation.qty === null
            ? null
            : amountUSD(p.valuation.qty, holdings[p.valuation.asset].price)
          : hasCost
            ? null
            : 0n;
    p.floating =
      p.valuationUSD === null || p.basis === null
        ? null
        : p.valuationUSD - p.basis;
    const selected = p.settlements.filter((s) =>
      inRange(s.date, range.start, range.end),
    );
    p.realized = nullableSum(selected.map((s) => s.pnl));
    if ((hasCost && !p.valuation) || p.valuation?.qty === null)
      issues.push({
        severity: "warning",
        message: `${p.project.name}：未结算估值待补充`,
        projectId: p.project.id,
      });
    if (p.reserve) holdings[p.reserve.asset].reserved += dec(p.reserve.qty);
    const asset =
      p.valuation?.asset ??
      p.lots.find((l) => l.remaining > 0n)?.asset ??
      "USD";
    holdings[asset].projectValue = nullableSum([
      holdings[asset].projectValue,
      p.valuationUSD,
    ]);
    holdings[asset].floating = nullableSum([
      holdings[asset].floating,
      p.floating,
    ]);
    for (const s of selected)
      holdings[s.asset].realized = nullableSum([
        holdings[s.asset].realized,
        s.pnl,
      ]);
  }
  for (const asset of ASSETS) {
    const h = holdings[asset];
    h.available = h.qty - h.reserved;
    const toUSD = (qty: bigint): bigint | null =>
      qty === 0n ? 0n : h.price === null ? null : mul(qty, dec(h.price));
    h.value = toUSD(h.qty);
    h.availableValue = toUSD(h.available);
    h.reserveValue = toUSD(h.reserved);
    if (h.available < 0n || h.qty < 0n)
      issues.push({
        severity: "warning",
        message: `${asset} ${h.qty < 0n ? "当前余额" : "可用余额"}为负，请核对期初、占用及流水`,
        asset,
      });
    if (
      h.price === null &&
      (h.qty !== 0n ||
        projects.some(
          (p) => p.valuation?.asset === asset && p.valuation.qty !== "0",
        ))
    )
      issues.push({
        severity: "warning",
        message: `${asset} 价格缺失，当前价值统计不完整`,
        asset,
      });
  }
  const list = Object.values(holdings);
  const core = nullableSum(list.map((h) => h.value)),
    valuation = nullableSum(projects.map((p) => p.valuationUSD));
  return {
    holdings,
    projects,
    settlements,
    issues,
    core,
    available: nullableSum(list.map((h) => h.availableValue)),
    reserved: nullableSum(list.map((h) => h.reserveValue)),
    valuation,
    total: nullableSum([core, valuation]),
    realized: nullableSum(projects.map((p) => p.realized)),
    floating: nullableSum(projects.map((p) => p.floating)),
    netDeposit,
    deposits,
    withdrawals,
    cashFees,
  };
}
