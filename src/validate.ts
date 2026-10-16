import { ASSETS, today, type Asset, type Book } from "./model.js";
import { dec, div, str } from "./decimal.js";
import { calculate } from "./engine.js";
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("对象结构不正确");
  return v as Record<string, unknown>;
};
const text = (
  v: unknown,
  name: string,
  max = 2000,
  required = false,
): string => {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    throw new Error(`${name}为空或超过 ${max} 字`);
  return v;
};
const asset = (v: unknown): Asset => {
  if (!ASSETS.includes(v as Asset))
    throw new Error("币种只能为 BTC、ETH、BNB、SOL、USD");
  return v as Asset;
};
function quantity(
  v: unknown,
  name: string,
  signed = false,
  positive = false,
): void {
  const n = dec(text(v, name, 50, true));
  if ((!signed && n < 0n) || (positive && n <= 0n))
    throw new Error(`${name}须为${positive ? "正数" : "非负数"}`);
}
export function validDate(v: unknown): void {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new Error("日期须是有效的 YYYY-MM-DD");
}
function money(v: unknown, historical = false, zero = false): void {
  if (v === null) return;
  const m = object(v);
  asset(m.asset);
  quantity(m.qty, "数量", false, !zero);
  if (historical && m.price !== null)
    quantity(m.price, "历史 USD 单价", false, true);
  if (historical && m.asset === "USD" && m.price !== "1")
    throw new Error("USD 历史价格固定为 1");
}
export function assertBook(raw: unknown, replay = true): asserts raw is Book {
  const b = object(raw);
  if (b.schema !== 1) throw new Error("不支持此备份版本，需要 schema: 1");
  text(b.id, "账本 ID", 128, true);
  text(b.name, "账本名称", 100, true);
  if (!Number.isSafeInteger(b.revision) || Number(b.revision) < 0)
    throw new Error("账本修订号错误");
  if (
    !Array.isArray(b.projects) ||
    !Array.isArray(b.entries) ||
    !Array.isArray(b.audit) ||
    b.entries.length > 50000 ||
    b.projects.length > 10000
  )
    throw new Error("数据列表错误，支持最多 50,000 条流水与 10,000 个项目");
  const projectIds = new Set<string>(),
    entryIds = new Set<string>();
  for (const rawProject of b.projects) {
    const p = object(rawProject);
    const id = text(p.id, "项目 ID", 128, true);
    if (projectIds.has(id)) throw new Error("项目 ID 重复");
    projectIds.add(id);
    text(p.name, "项目名称", 120, true);
    text(p.category, "分类", 80, true);
    text(p.account, "账户标签", 120);
    text(p.notes, "项目备注", 4000);
    text(p.createdAt, "创建时间", 40, true);
    if (p.related !== null) text(p.related, "关联项目 ID", 128, true);
  }
  for (const rawProject of b.projects) {
    const p = object(rawProject);
    if (
      p.related !== null &&
      (!projectIds.has(p.related as string) || p.related === p.id)
    )
      throw new Error("关联项目不存在或关联自身");
  }
  for (const rawEntry of b.entries) {
    const e = object(rawEntry),
      id = text(e.id, "流水 ID", 128, true);
    if (entryIds.has(id)) throw new Error("流水 ID 重复");
    entryIds.add(id);
    validDate(e.date);
    if ((e.date as string) > today())
      throw new Error("实际发生日期不能在未来；预期回报请记入项目估值");
    text(e.createdAt, "创建时间", 40, true);
    text(e.account, "账户", 120);
    text(e.note, "备注", 4000);
    if (typeof e.deleted !== "boolean") throw new Error("流水撤销状态错误");
    if (e.kind === "investment") {
      if (!projectIds.has(text(e.projectId, "项目 ID", 128, true)))
        throw new Error("关联的投资项目不存在");
      money(e.cost, true);
      money(e.recovery, true);
      money(e.fee, true);
      money(e.reserve, false, true);
      if (e.feeTreatment !== "cost" && e.feeTreatment !== "settlement")
        throw new Error("费用归属错误");
      if (e.fee && e.feeTreatment === "cost" && !e.cost)
        throw new Error(
          "费用计入成本时，必须填写本次实际投入；否则选本次结算费用",
        );
      if (!Array.isArray(e.release) || e.release.length > 5)
        throw new Error("结转成本结构错误");
      const released = new Set();
      for (const r of e.release) {
        money(r);
        const m = object(r);
        if (released.has(m.asset)) throw new Error("同一币种结转成本只能一行");
        released.add(m.asset);
      }
      if (e.valuation !== null) {
        const v = object(e.valuation);
        asset(v.asset);
        if (v.qty !== null) quantity(v.qty, "剩余估值");
      }
      if (![null, "active", "closed"].includes(e.projectState as null))
        throw new Error("项目状态错误");
      if (
        !e.cost &&
        !e.recovery &&
        !e.fee &&
        !e.reserve &&
        !e.valuation &&
        !e.release.length &&
        !e.projectState
      )
        throw new Error("至少录入一项资金变动、估值、占用或状态");
    } else if (e.kind === "cash") {
      if (
        !["in", "out"].includes(e.direction as string) ||
        !["CNY", "HKD"].includes(e.fiat as string)
      )
        throw new Error("法币方向或币种错误");
      quantity(e.fiatAmount, "法币金额", false, true);
      quantity(e.usdAmount, "USD 金额", false, true);
      quantity(e.fee, "额外 USD 手续费");
      if (
        e.direction === "in" &&
        dec(e.fee as string) >= dec(e.usdAmount as string)
      )
        throw new Error("入金手续费须小于对应 USD 金额");
      const expected = str(
        div(dec(e.fiatAmount as string), dec(e.usdAmount as string)),
      );
      if (e.rate !== expected)
        throw new Error("历史汇率不一致，应为法币金额 ÷ 对应 USD 金额");
      if (!["USD", "USDT", "USDC"].includes(e.payment as string))
        throw new Error("实际支付币种错误");
      quantity(e.paymentAmount, "实际支付数量", false, true);
      if (
        e.payment === "USD" &&
        dec(e.paymentAmount as string) !== dec(e.usdAmount as string)
      )
        throw new Error("实际 USD 数量必须等于对应 USD 金额");
    } else if (e.kind === "exchange") {
      if (e.from === null || e.to === null)
        throw new Error("兑换必须同时填写换出和换入");
      money(e.from);
      money(e.to);
      money(e.fee);
      if (object(e.from).asset === object(e.to).asset)
        throw new Error("换出和换入币种须不同");
    } else if (e.kind === "opening" || e.kind === "adjustment") {
      asset(e.asset);
      quantity(e.qty, "余额数量", e.kind === "adjustment");
      text(e.reason, "调整原因", 1000, true);
    } else throw new Error("未知流水类型");
  }
  const prices = object(b.prices);
  for (const a of ASSETS) {
    const p = object(prices[a]);
    if (p.value !== null) quantity(p.value, "币价", false, true);
    if (
      p.at !== null &&
      (typeof p.at !== "string" || !Number.isFinite(Date.parse(p.at)))
    )
      throw new Error("币价时间格式错误");
    if (!["market", "manual", "demo", "missing"].includes(p.source as string))
      throw new Error("币价来源错误");
    if (p.error !== null) text(p.error, "行情错误", 500);
  }
  if (object(prices.USD).value !== "1") throw new Error("USD 单价须为 1");
  const settings = object(b.settings);
  if (
    typeof settings.auto !== "boolean" ||
    ![1, 2, 5, 10, 15, 30, 60].includes(Number(settings.interval))
  )
    throw new Error("刷新设置错误");
  for (const a of b.audit) {
    const x = object(a);
    text(x.action, "历史动作", 200, true);
    text(x.at, "历史时间", 40, true);
    text(x.entityId, "历史对象 ID", 128, true);
  }
  if (replay) {
    const errors = calculate(raw as Book).issues.filter(
      (i) => i.severity === "error",
    );
    if (errors.length) throw new Error(errors.map((e) => e.message).join("；"));
  }
}
