import { ASSETS, type Asset, type Book, type Entry } from "./model.js";
import { calculate, inRange, type ProjectResult } from "./engine.js";
import { dec, mul, nullableSum, str } from "./decimal.js";
import { priceStatus } from "./prices.js";
import {
  assetName,
  assetsOf,
  btn,
  coin,
  colors,
  dateLabel,
  empty,
  entryAmount,
  entryName,
  entryType,
  esc,
  field,
  icon,
  option,
  pnlClass,
  qty,
  select,
  usd,
  type ViewState,
} from "./ui.js";
export const pageNames = {
  dashboard: "仪表盘",
  investments: "投资记录",
  holdings: "持仓",
  cash: "法币出入金",
  prices: "币价更新",
  data: "数据管理",
};
export function shell(s: ViewState): string {
  return `<aside class="sidebar"><a class="brand" href="#dashboard"><img src="./favicon.svg" width="38" height="38" alt=""/><span>拾账<small>Crypto 投资账本</small></span></a><nav aria-label="主要导航">${Object.entries(
    pageNames,
  )
    .map(
      ([key, name]) =>
        `<a href="#${key}" aria-label="${name}" class="nav-link ${s.page === key ? "active" : ""}" ${s.page === key ? 'aria-current="page"' : ""}>${icon(key)}<span class="nav-label">${name}</span><span class="nav-mobile">${({ investments: "投资", cash: "出入金", prices: "币价", data: "数据" } as Record<string, string>)[key] ?? name}</span>${key === "investments" ? `<span class="nav-count" aria-hidden="true">${s.book.projects.length}</span>` : ""}</a>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom">${icon("lock")}<div><strong>账本留在你手里</strong><span>本机保存 · 随时备份</span></div></div></aside>
  <div class="workspace"><header class="topbar"><div class="breadcrumb">个人空间 <span>/</span> <strong>${pageNames[s.page]}</strong></div><div class="top-tools"><span class="save-status">${icon(s.demo ? "info" : "check")}${s.demo ? "演示账本" : s.locked ? "账本已锁定" : s.savedAt ? "已加密保存" : "本机账本"}</span>${btn(icon("download") + "<span>备份</span>", "backup", "quiet")}${btn(icon("lock") + `<span>${s.demo ? (s.hasVault ? "解锁账本" : "创建账本") : "锁定"}</span>`, s.demo ? "vault" : "lock", "quiet")}</div></header>
  <main id="main" tabindex="-1">${s.demo ? `<div class="demo-banner"><span><strong>演示模式</strong> · 所有金额与项目均为虚构</span>${btn(s.hasVault ? "解锁我的账本" : "创建私密账本", "vault", "text-button")}</div>` : ""}${s.storageError ? `<div class="notice danger" role="alert">${esc(s.storageError)}</div>` : ""}${pageContent(s)}</main><footer class="page-footer"><span>拾账 · 每一笔，都有依据</span><a href="#data">计算口径与数据说明 ${icon("arrow")}</a></footer></div>`;
}
function pageContent(s: ViewState): string {
  switch (s.page) {
    case "dashboard":
      return dashboard(s);
    case "investments":
      return investments(s);
    case "holdings":
      return holdings(s);
    case "cash":
      return cash(s);
    case "prices":
      return prices(s);
    case "data":
      return dataView(s);
  }
}
const title = (
  name: string,
  sub: string,
  action: string,
  label: string,
  more = "",
): string =>
  `<div class="page-heading"><div><h1>${name}</h1><p>${sub}</p></div><div class="heading-actions">${more}${btn(icon("plus") + label, action, "primary")}</div></div>`;
function rangeFilter(s: ViewState): string {
  return `<form id="range-form" class="range-filter"><span>结算 / 出入金日期</span>${field("开始日期", "start", s.range.start, "date")}${field("结束日期", "end", s.range.end, "date")}<button class="btn secondary" type="submit">应用</button>${s.range.start || s.range.end ? btn("全部日期", "range-reset", "text-button") : ""}</form>`;
}
function issueNotice(s: ViewState): string {
  const issues = s.result.issues;
  const stale = ASSETS.filter(
    (a) =>
      a !== "USD" &&
      ["价格过期", "更新失败"].includes(
        priceStatus(s.book.prices[a], s.book.settings.interval),
      ),
  );
  if (!issues.length && !stale.length) return "";
  return `<details class="notice"><summary>${icon("info")} ${issues.length ? `${issues.length} 项账务信息待核对` : ""}${issues.length && stale.length ? " · " : ""}${stale.length ? "行情过期或更新失败" : ""}<span>查看明细</span></summary><ul>${issues.map((i) => `<li>${esc(i.message)} ${i.projectId ? btn("查看项目", "project", "text-button", `data-id="${esc(i.projectId)}"`) : i.asset ? btn("查看来源", "sources", "text-button", `data-asset="${i.asset}"`) : ""}</li>`).join("")}${stale.length ? `<li>${stale.join("、")} 保留上次成功价格，当前资产价值仅供核对。<a href="#prices">更新行情</a></li>` : ""}</ul></details>`;
}
function metric(
  label: string,
  n: bigint | null,
  action: string,
  sub: string,
  signed = false,
  extra = "",
): string {
  return `<button type="button" class="metric" data-action="${action}" ${extra}><span class="metric-label">${label}${icon("arrow")}</span><strong class="${signed ? pnlClass(n) : ""}">${usd(n, signed)}</strong><span class="metric-note">${sub}</span></button>`;
}
function dashboard(s: ViewState): string {
  const r = s.result;
  return `${title("资产一览", "投入有记录，收益有依据。", "new", "记一笔")}${issueNotice(s)}<div class="dashboard-grid"><section class="total-panel"><div class="section-title"><span>含项目估值的总资产</span><span class="muted">当前数据 · USD</span></div><button type="button" class="total-value" data-action="metric" data-metric="total">${usd(r.total)}${icon("arrow")}</button><p class="total-caption">核心持仓 + 未结算项目估值</p><div class="hero-breakdown">${metric("核心持仓", r.core, "metric", "已到账的五种核心资产", false, 'data-metric="core"')}${metric("项目估值", r.valuation, "metric", "手动估值，不可用于支付", false, 'data-metric="valuation"')}</div><div class="balance-strip"><button type="button" data-action="metric" data-metric="available"><i class="dot available-dot"></i>可用 ${usd(r.available)}</button><button type="button" data-action="metric" data-metric="reserved"><i class="dot reserved-dot"></i>占用 ${usd(r.reserved)}</button></div></section><section class="panel allocation-panel"><div class="section-title"><h2>资产配比</h2><label class="inline-select"><span class="sr-only">资产配比口径</span><select id="chart-mode">${option("core", "核心持仓", s.chart)}${option("available", "可用资金", s.chart)}${option("reserved", "占用资金", s.chart)}${option("total", "含项目估值", s.chart)}</select></label></div>${donut(s)}</section></div>
  <div class="metrics-row">${metric("已结算盈亏", r.realized, "metric", "历史结算价格 · 按所选日期", true, 'data-metric="realized"')}${metric("浮动盈亏", r.floating, "metric", "当前剩余估值 − 历史剩余成本", true, 'data-metric="floating"')}${metric("净入金", r.netDeposit, "metric", "外部入金 − 外部出金", false, 'data-metric="net"')}${metric("可用资金", r.available, "metric", "当前持仓 − 资金占用", false, 'data-metric="available"')}</div>
  ${rangeFilter(s)}<section class="panel"><div class="section-title"><div><h2>核心持仓</h2><p>当前数量与价值，不随日期筛选改变</p></div><a href="#holdings" class="link-arrow">查看全部 ${icon("arrow")}</a></div>${holdingsTable(s, false)}</section>
  <div class="two-col"><section class="panel"><div class="section-title"><h2>项目盈亏</h2><span class="muted">USD</span></div>${pnlBars(s, "floating")}${pnlBars(s, "realized")}</section><section class="panel"><div class="section-title"><h2>最近流水</h2><a href="#investments" class="link-arrow">全部记录 ${icon("arrow")}</a></div>${recent(s)}</section></div>`;
}
function donut(s: ViewState): string {
  const r = s.result;
  const mode = s.chart;
  const parts = ASSETS.map((a) => ({
    asset: a,
    label: a,
    value:
      mode === "available"
        ? r.holdings[a].availableValue
        : mode === "reserved"
          ? r.holdings[a].reserveValue
          : r.holdings[a].value,
  }));
  if (mode === "total")
    for (const a of ASSETS) {
      parts.find((p) => p.asset === a)!.value = nullableSum([
        parts.find((p) => p.asset === a)!.value,
        ...r.projects
          .filter((p) => p.valuation?.asset === a)
          .map((p) => p.valuationUSD),
      ]);
    }
  const total =
    mode === "total" && r.total === null
      ? null
      : nullableSum(parts.map((p) => p.value));
  if (total === null || parts.some((p) => p.value !== null && p.value < 0n))
    return `<div class="chart-empty">${icon("info")}<p>${total === null ? "价格或估值待补充，暂不能计算完整配比。" : "存在负余额，配比图暂停。请先核对余额来源。"}</p><a href="#holdings">查看持仓明细</a></div>`;
  let offset = 0;
  const circumference = 2 * Math.PI * 65;
  const arcs = parts
    .filter((p) => (p.value ?? 0n) > 0n)
    .map((p) => {
      const ratio = Number(p.value) / Number(total);
      const dash = ratio * circumference;
      const circle = `<circle cx="90" cy="90" r="65" fill="none" stroke="${colors[p.asset]}" stroke-width="19" stroke-dasharray="${Math.max(0, dash - 3)} ${circumference}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)"/>`;
      offset += dash;
      return circle;
    })
    .join("");
  return `<div class="allocation-content"><div class="donut" role="img" aria-label="${esc(mode)}资产配比，详细数值见旁边列表"><svg viewBox="0 0 180 180" aria-hidden="true"><circle cx="90" cy="90" r="65" fill="none" stroke="var(--line)" stroke-width="19"/>${arcs}</svg><div class="donut-center"><strong>${total === 0n ? "0" : parts.filter((p) => (p.value ?? 0n) > 0n).length}</strong><span>${total === 0n ? "暂无资产" : "资产种类"}</span></div></div><ul class="legend">${parts.map((p) => `<li><button type="button" data-action="sources" data-asset="${p.asset}"><span><i class="dot" style="background:${colors[p.asset]}"></i>${p.label}</span><strong>${total > 0n ? ((Number(p.value) / Number(total)) * 100).toFixed(1) : "0.0"}%</strong></button></li>`).join("")}</ul></div>`;
}
function holdingsTable(s: ViewState, full: boolean): string {
  const hs = ASSETS.map((a) => s.result.holdings[a]);
  return `<div class="table-wrap"><table class="holdings-table ${full ? "full" : ""}"><thead><tr><th>资产</th><th class="numeric">当前数量</th><th class="numeric">可用 / 占用</th><th class="numeric">当前价格</th><th class="numeric">持仓价值</th>${full ? '<th class="numeric">项目估值</th><th class="numeric">结算 / 浮动盈亏</th>' : ""}</tr></thead><tbody>${hs.map((h) => `<tr><td data-label="资产"><button class="asset-cell" type="button" data-action="sources" data-asset="${h.asset}">${coin(h.asset)}<span><strong>${h.asset}</strong><small>${assetName[h.asset]}</small></span></button></td><td class="numeric" data-label="当前数量"><button class="value-link ${h.qty < 0n ? "negative" : ""}" type="button" data-action="sources" data-asset="${h.asset}">${qty(h.qty)}</button></td><td class="numeric" data-label="可用 / 占用"><span class="${h.available < 0n ? "negative" : ""}">${qty(h.available)}</span><small class="muted">占用 ${qty(h.reserved)}</small></td><td class="numeric" data-label="当前价格">${h.price ? usd(dec(h.price)) : "待补充"}<small class="muted">${h.asset === "USD" ? "计价单位" : priceStatus(s.book.prices[h.asset], s.book.settings.interval)}</small></td><td class="numeric" data-label="持仓价值"><strong>${usd(h.value)}</strong></td>${full ? `<td class="numeric" data-label="项目估值">${usd(h.projectValue)}</td><td class="numeric" data-label="结算 / 浮动盈亏"><span class="${pnlClass(h.realized)}">${usd(h.realized, true)}</span><small class="${pnlClass(h.floating)}">浮动 ${usd(h.floating, true)}</small></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}
function pnlBars(s: ViewState, key: "floating" | "realized"): string {
  const rows = s.result.projects.filter((p) => p[key] !== 0n);
  const max = Math.max(1, ...rows.map((p) => Math.abs(Number(p[key] ?? 0n))));
  return `<div class="pnl-chart"><h3>${key === "floating" ? "未结算浮动盈亏" : "历史已结算盈亏"}</h3>${!rows.length ? '<p class="muted">暂无盈亏记录</p>' : rows.map((p) => `<button class="bar-row" type="button" data-action="project" data-id="${esc(p.project.id)}"><span>${esc(p.project.name)}</span><span class="bar-track"><i class="zero-line"></i>${p[key] === null ? "" : `<i class="pnl-bar ${p[key]! < 0n ? "loss" : "gain"}" style="width:${(Math.abs(Number(p[key])) / max) * 48}%"></i>`}</span><strong class="${pnlClass(p[key])}">${usd(p[key], true)}</strong></button>`).join("")}<div class="bar-axis"><span>亏损 ←</span><span>0</span><span>→ 盈利</span></div></div>`;
}
function recent(s: ViewState): string {
  const entries = s.book.entries
    .filter((e) => !e.deleted)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, 5);
  return entries.length
    ? `<ul class="activity-list">${entries.map((e) => `<li><button type="button" data-action="entry" data-id="${esc(e.id)}"><span class="activity-icon">${icon(e.kind === "cash" ? "cash" : e.kind === "exchange" ? "refresh" : "investments")}</span><span class="activity-name"><strong>${esc(entryName(e, s.book))}</strong><small>${dateLabel(e.date)} · ${entryType(e)}</small></span><span class="activity-amount">${esc(entryAmount(e))}</span></button></li>`).join("")}</ul>`
    : empty("还没有流水", "从一笔期初余额或法币入金开始。");
}
function holdings(s: ViewState): string {
  return `${title("核心持仓", "五种资产，统一账务。当前数据不受日期筛选影响。", "new-adjustment", "期初 / 调整", btn("手动兑换", "new-exchange", "secondary"))}${issueNotice(s)}<div class="metrics-row three">${metric("当前持仓价值", s.result.core, "metric", "按当前价格折算", false, 'data-metric="core"')}${metric("可用资金", s.result.available, "metric", "可以继续投入的核心资产", false, 'data-metric="available"')}${metric("占用资金", s.result.reserved, "metric", "仍在持仓中，不重复计入总资产", false, 'data-metric="reserved"')}</div><section class="panel"><div class="section-title"><h2>持仓明细</h2><span class="muted">点击数量追溯来源</span></div>${holdingsTable(s, true)}</section><div class="notice">已结算盈亏按回收币种归属，浮动盈亏按估值币种归属；金额统一为 USD。余额调整及兑换不会计为项目盈利。</div><section class="panel"><div class="section-title"><h2>期初、调整与兑换</h2></div>${entryTable(s.book.entries.filter((e) => ["opening", "adjustment", "exchange"].includes(e.kind) && !e.deleted).reverse(), s.book)}</section>`;
}
function filteredEntries(s: ViewState): Entry[] {
  const f = s.filters;
  return s.book.entries
    .filter((e) => e.kind === "investment" && (f.deleted || !e.deleted))
    .filter((e) => {
      const p =
        e.kind === "investment"
          ? s.result.projects.find((p) => p.project.id === e.projectId)
          : undefined;
      return (
        (!f.search ||
          `${entryName(e, s.book)} ${e.note} ${e.account} ${p?.project.notes ?? ""}`
            .toLowerCase()
            .includes(f.search.toLowerCase())) &&
        (!f.project || p?.project.id === f.project) &&
        (!f.category || p?.project.category === f.category) &&
        (!f.status || (e.deleted ? "deleted" : p?.status) === f.status) &&
        (!f.asset || assetsOf(e).includes(f.asset as Asset)) &&
        (!f.account ||
          e.account === f.account ||
          p?.project.account === f.account) &&
        inRange(e.date, f.start, f.end)
      );
    })
    .sort((a, b) =>
      f.sort === "oldest"
        ? a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
        : f.sort === "name"
          ? entryName(a, s.book).localeCompare(entryName(b, s.book), "zh")
          : b.date.localeCompare(a.date) ||
            b.createdAt.localeCompare(a.createdAt),
    );
}
function investments(s: ViewState): string {
  const f = s.filters,
    list = filteredEntries(s);
  const categories = [...new Set(s.book.projects.map((p) => p.category))];
  const accounts = [
    ...new Set([
      ...s.book.projects.map((p) => p.account),
      ...s.book.entries.map((e) => e.account),
    ]),
  ].filter(Boolean);
  return `${title("投资记录", "实际到账记回款，预期回报记估值。", "new", "记一笔", btn("新建项目", "new-project", "secondary"))}${issueNotice(s)}<section class="panel"><div class="section-title"><h2>项目总览 <span class="muted">${s.book.projects.length}</span></h2><span class="muted">关联项目仅作标签，不重复入账</span></div>${s.result.projects.length ? `<div class="project-grid">${s.result.projects.map((p) => `<button type="button" class="project-tile" data-action="project" data-id="${esc(p.project.id)}"><div><span class="project-category">${esc(p.project.category)}</span><span class="status ${p.status}">${p.status === "active" ? "进行中" : "已结束"}</span></div><h3>${esc(p.project.name)}</h3><div class="project-tile-footer"><span>剩余成本 <strong>${usd(p.basis)}</strong></span><span>估值 <strong>${usd(p.valuationUSD)}</strong></span></div></button>`).join("")}</div>` : empty("建立你的第一个项目", "空投、NFT、打新，都可按项目管理。", "new-project", "新建项目")}</section>
  <section class="panel"><div class="section-title"><h2>投资流水</h2><span class="muted">${list.length} 条记录</span></div><form id="filter-form" class="filters"><label class="field search-field"><span>搜索</span><div class="search-input">${icon("search")}<input name="search" type="search" value="${esc(f.search)}" placeholder="项目、备注、账户"/></div></label>${select("项目", "project", option("", "全部项目", f.project) + s.book.projects.map((p) => option(p.id, p.name, f.project)).join(""))}${select("分类", "category", option("", "全部分类", f.category) + categories.map((c) => option(c, c, f.category)).join(""))}${select("状态", "status", option("", "全部状态", f.status) + option("active", "进行中", f.status) + option("closed", "已结束", f.status) + option("deleted", "已撤销", f.status))}${select("币种", "asset", option("", "全部币种", f.asset) + ASSETS.map((a) => option(a, a, f.asset)).join(""))}${select("账户", "account", option("", "全部账户", f.account) + accounts.map((a) => option(a, a, f.account)).join(""))}${field("开始日期", "start", f.start, "date")}${field("结束日期", "end", f.end, "date")}${select("排序", "sort", option("newest", "日期从新到旧", f.sort) + option("oldest", "日期从旧到新", f.sort) + option("name", "项目名称", f.sort))}<label class="check-label"><input type="checkbox" name="deleted" ${f.deleted ? "checked" : ""}/>显示已撤销</label><div class="filter-actions"><button class="btn secondary" type="submit">应用筛选</button>${btn("重置", "filter-reset", "text-button")}</div></form>${list.length ? entryTable(list, s.book) : empty("没有匹配的流水", "调整筛选条件，或记录一笔新投资。", "filter-reset", "清除筛选")}</section>`;
}
export function entryTable(entries: Entry[], book: Book): string {
  return entries.length
    ? `<div class="table-wrap"><table class="entry-table"><thead><tr><th>日期</th><th>项目 / 内容</th><th>类型</th><th>资金变动</th><th>账户</th><th>操作</th></tr></thead><tbody>${entries.map((e) => `<tr class="${e.deleted ? "deleted-row" : ""}"><td data-label="日期">${dateLabel(e.date)}</td><td data-label="项目 / 内容"><button type="button" class="value-link" data-action="entry" data-id="${esc(e.id)}">${esc(entryName(e, book))}</button>${e.note ? `<small class="muted">${esc(e.note)}</small>` : ""}</td><td data-label="类型"><span class="status ${e.deleted ? "deleted" : ""}">${e.deleted ? "已撤销" : entryType(e)}</span></td><td data-label="资金变动">${esc(entryAmount(e))}</td><td data-label="账户">${esc(e.account || (e.kind === "investment" ? book.projects.find((p) => p.id === e.projectId)?.account : "") || "未标记")}</td><td data-label="操作"><div class="row-actions">${e.deleted ? btn("恢复", "restore", "text-button", `data-id="${esc(e.id)}"`) : btn("编辑", "edit-entry", "text-button", `data-id="${esc(e.id)}"`) + btn("撤销", "delete", "text-button danger-text", `data-id="${esc(e.id)}"`)}</div></td></tr>`).join("")}</tbody></table></div>`
    : empty("暂无记录", "保存的每一笔变动都会显示在这里。");
}
function cash(s: ViewState): string {
  const entries = s.book.entries.filter(
    (e) =>
      e.kind === "cash" &&
      !e.deleted &&
      inRange(e.date, s.range.start, s.range.end),
  );
  return `${title("法币出入金", "CNY、HKD 分开统计；资金进出不计为投资盈利。", "new-cash", "记出入金")}${rangeFilter(s)}<div class="metrics-row three">${metric("累计入金", s.result.deposits, "metric", "对应 USD 总额 · 未扣额外手续费", false, 'data-metric="net"')}${metric("累计出金", s.result.withdrawals, "metric", "对应 USD 总额 · 未加额外手续费", false, 'data-metric="net"')}${metric("净入金", s.result.netDeposit, "metric", `另付手续费 ${usd(s.result.cashFees)}`, false, 'data-metric="net"')}</div><div class="two-col">${(
    ["CNY", "HKD"] as const
  )
    .map((fiat) => {
      const es = entries.filter((e) => e.kind === "cash" && e.fiat === fiat);
      const inside = es.reduce(
          (a, e) =>
            a +
            (e.kind === "cash" && e.direction === "in"
              ? dec(e.fiatAmount)
              : 0n),
          0n,
        ),
        out = es.reduce(
          (a, e) =>
            a +
            (e.kind === "cash" && e.direction === "out"
              ? dec(e.fiatAmount)
              : 0n),
          0n,
        );
      return `<section class="panel fiat-panel"><h2>${fiat === "CNY" ? "人民币" : "港币"} <span class="muted">${fiat}</span></h2><dl><div><dt>入金</dt><dd>${str(inside)} ${fiat}</dd></div><div><dt>出金</dt><dd>${str(out)} ${fiat}</dd></div><div><dt>净入金</dt><dd>${str(inside - out)} ${fiat}</dd></div></dl></section>`;
    })
    .join(
      "",
    )}</div><section class="panel"><div class="section-title"><h2>出入金记录</h2><span class="muted">汇率：1 USD = 多少法币</span></div>${entries.length ? `<div class="table-wrap"><table><thead><tr><th>日期 / 方向</th><th>法币金额</th><th>对应 USD</th><th>成交汇率</th><th>手续费</th><th>操作</th></tr></thead><tbody>${entries.map((e) => (e.kind === "cash" ? `<tr><td data-label="日期 / 方向">${dateLabel(e.date)}<small>${e.direction === "in" ? "入金" : "出金"}</small></td><td data-label="法币金额">${e.fiatAmount} ${e.fiat}</td><td data-label="对应 USD">${usd(dec(e.usdAmount))}<small class="muted">实际 ${e.paymentAmount} ${e.payment}</small></td><td data-label="成交汇率">1 USD = ${e.rate} ${e.fiat}</td><td data-label="手续费">${usd(dec(e.fee))}</td><td data-label="操作"><div class="row-actions">${btn("编辑", "edit-entry", "text-button", `data-id="${esc(e.id)}"`)}${btn("撤销", "delete", "text-button danger-text", `data-id="${esc(e.id)}"`)}</div></td></tr>` : "")).join("")}</tbody></table></div>` : empty("先记录一笔入金", "填写法币成交金额与实际对应 USD，系统自动保存汇率。", "new-cash", "记出入金")}</section>`;
}
function prices(s: ViewState): string {
  return `<div class="page-heading"><div><h1>币价更新</h1><p>仅影响当前价值，不改数量与历史结算。</p></div>${btn(icon("refresh") + (s.refreshing ? "正在刷新…" : "刷新行情"), "refresh", "primary", s.refreshing ? "disabled" : "")}</div>${s.demo ? '<div class="notice">当前为虚构演示价格。手动刷新会替换为实际市场价格，并保留演示标签。</div>' : ""}<section class="panel"><div class="section-title"><h2>行情设置</h2><a href="https://www.coingecko.com/" target="_blank" rel="noreferrer">CoinGecko 行情来源 ${icon("external")}</a></div><form id="price-settings" class="settings-form"><label class="check-label"><input name="auto" type="checkbox" ${s.book.settings.auto ? "checked" : ""}/>页面打开时自动更新</label>${select("更新间隔", "interval", [1, 2, 5, 10, 15, 30, 60].map((n) => option(String(n), `${n} 分钟`, String(s.book.settings.interval))).join(""))}<button class="btn secondary" type="submit">保存设置</button></form><p class="muted">免费公开行情可能限流。失败保留最后成功价格；超过刷新间隔两倍或 5 分钟（取较长）标为过期。USD 固定为 1。</p></section><section class="panel"><div class="table-wrap"><table><thead><tr><th>资产</th><th>USD 价格</th><th>来源 / 状态</th><th>价格时间</th><th>操作</th></tr></thead><tbody>${ASSETS.map(
    (a) => {
      const p = s.book.prices[a];
      return `<tr><td data-label="资产"><span class="asset-cell">${coin(a)}<strong>${a}</strong></span></td><td data-label="USD 价格">${p.value ? usd(dec(p.value)) : "待补充"}</td><td data-label="来源 / 状态"><span class="status">${a === "USD" ? "计价单位" : priceStatus(p, s.book.settings.interval)}</span>${p.error ? `<small class="negative">${esc(p.error)}</small>` : ""}</td><td data-label="价格时间">${p.at ? esc(new Date(p.at).toLocaleString("zh-CN", { hour12: false })) : "固定 / 未设置"}</td><td data-label="操作">${a === "USD" ? "固定价格" : btn("手动备用", "manual-price", "text-button", `data-asset="${a}"`)}</td></tr>`;
    },
  ).join(
    "",
  )}</tbody></table></div></section><div class="notice">手动备用价格会明确标记，下一次成功的市场刷新会替换它。关闭自动更新可持续使用手动价格。其他代币、NFT 等项目仅通过估值与回款管理。</div>`;
}
function dataView(s: ViewState): string {
  const deleted = s.book.entries.filter((e) => e.deleted);
  return `${title("数据管理", "保存、迁移与核对你的账本。", "import", "导入数据")}
  <div class="two-col"><section class="panel"><div class="section-title"><h2>账本与备份</h2>${icon("lock")}</div><p>${s.demo ? "目前正在体验虚构演示账本。创建私密账本后，个人记录将用独立口令加密保存。" : "本账本保存在此浏览器，使用 AES-GCM 加密。口令只在解锁时使用，不上传、不保存。"}</p><dl class="data-facts"><div><dt>账本名称</dt><dd>${esc(s.book.name)}</dd></div><div><dt>记录数</dt><dd>${s.book.entries.length} 条 · ${s.book.projects.length} 个项目</dd></div><div><dt>修订号</dt><dd>${s.book.revision}</dd></div></dl><div class="button-row">${btn("下载" + (s.demo ? "演示" : "加密") + "备份", "backup", "secondary")}${btn("恢复备份", "restore-backup", "secondary")}${!s.demo ? btn("更改口令", "change-password", "text-button") : btn("创建 / 解锁账本", "vault", "text-button")}</div><p class="muted">更换设备、清理浏览器前请备份。忘记口令无法找回；浏览器清理或无痕窗口关闭会删除本机数据。</p></section>
  <section class="panel"><div class="section-title"><h2>CSV 导入与导出</h2>${icon("file")}</div><p>可映射飞书导出的字段，预览后一次导入。重复流水跳过，错误行须修正后重新导入。</p><div class="button-row">${btn("导入 CSV", "import", "secondary")}${btn("导出全部 CSV", "export-csv", "secondary")}${btn("下载导入模板", "csv-template", "text-button")}</div><p class="muted">CSV 是未加密明文，包含已撤销记录。完整审计记录、币价和设置请用加密备份迁移。CSV 中本金结转支持 USD:500;ETH:0.1。</p></section></div>
  <section class="panel"><div class="section-title"><h2>撤销记录</h2><span class="muted">${deleted.length} 条，可恢复</span></div>${deleted.length ? entryTable(deleted, s.book) : '<p class="muted">暂无撤销记录。撤销前会确认，原始流水仍保留。</p>'}</section>
  <section class="panel"><div class="section-title"><h2>修改追溯</h2><span class="muted">最近 50 次 · 完整记录随备份保存</span></div>${
    s.book.audit.length
      ? `<ul class="audit-list">${s.book.audit
          .slice(-50)
          .reverse()
          .map(
            (a, i) =>
              `<li><span>${esc(new Date(a.at).toLocaleString("zh-CN"))}</span><strong>${esc(a.action)}</strong>${btn("查看变更", "audit", "text-button", `data-index="${s.book.audit.length - 1 - i}"`)}</li>`,
          )
          .join("")}</ul>`
      : '<p class="muted">创建、编辑、撤销与恢复都会在这里留下记录。</p>'
  }</section>
  <section class="panel rules-panel"><h2>统一计算口径</h2><dl><div><dt>核心余额</dt><dd>期初 + 净外部入金 + 实际回收 − 实际投入 − 额外手续费 + 余额调整 + 兑换净流入。</dd></div><div><dt>占用与估值</dt><dd>占用仍在持仓内，只减少可用数量。估值是未到账项目权益，不用于支付；更新是项目快照，不累计相加。</dd></div><div><dt>部分结算</dt><dd>按成本币种指定本次结转数量，同币种历史成本按先进先出分配。实际回款立即进入持仓，回款后必须重填剩余估值。</dd></div><div><dt>历史盈亏</dt><dd>回款 × 结算价格 − 对应历史成本及费用。历史价格为空时显示待补充。项目盈亏不包括法币出入金、兑换或核心币种自身涨跌。</dd></div><div><dt>费用</dt><dd>所有数量均为未含手续费的总额，手续费单列额外扣减一次。投入费用计入成本后随结转分摊；结算费用直接计入本次盈亏。出入金及兑换费用不算项目亏损。</dd></div><div><dt>估值变化</dt><dd>浮动盈亏 = 按当前行情折算的剩余估值 − 剩余历史 USD 成本。占用资金不作为额外项目估值。同币种结算另列币本位结果及其今日价值。</dd></div><div><dt>使用范围</dt><dd>单人、单浏览器账本，不同步钱包、不执行交易。联网私用部署请按 README 启用服务端身份验证和 HTTPS。禁止填写私钥、助记词或交易密钥。</dd></div></dl></section>`;
}
export function projectDetail(p: ProjectResult, book: Book): string {
  return `<div class="detail-meta"><span class="status ${p.status}">${p.status === "active" ? "进行中" : "已结束"}</span><span>${esc(p.project.category)}</span><span>${esc(p.project.account || "未标记账户")}</span></div><p class="muted">开始 ${dateLabel(p.start)}${p.end ? ` · 结束 ${dateLabel(p.end)}` : ""}${p.project.related ? ` · 关联 ${esc(book.projects.find((x) => x.id === p.project.related)?.name ?? "")}` : ""}</p><div class="detail-stats"><div><span>剩余历史成本</span><strong>${usd(p.basis)}</strong><small>${
    ASSETS.filter((a) => p.remaining[a] > 0n)
      .map((a) => `${str(p.remaining[a])} ${a}`)
      .join(" / ") || "已结清"
  }</small></div><div><span>剩余项目估值</span><strong>${usd(p.valuationUSD)}</strong><small>${p.valuation ? `${p.valuation.qty ?? "未知"} ${p.valuation.asset}` : "尚未设置"}</small></div><div><span>历史已结算盈亏</span><strong class="${pnlClass(p.realized)}">${usd(p.realized, true)}</strong></div><div><span>未结算浮动盈亏</span><strong class="${pnlClass(p.floating)}">${usd(p.floating, true)}</strong></div></div><p>当前占用：${p.reserve ? `${p.reserve.qty} ${p.reserve.asset}` : "0"}。占用已包含在核心持仓中。</p>${p.project.notes ? `<p class="note-text">${esc(p.project.notes)}</p>` : ""}<div class="button-row">${btn(icon("plus") + "追加流水", "new-project-entry", "primary", `data-id="${esc(p.project.id)}"`)}${btn("编辑项目资料", "edit-project", "secondary", `data-id="${esc(p.project.id)}"`)}</div><h3>关联流水</h3>${entryTable(p.entries, book)}<h3>结算明细（历史价格）</h3>${p.settlements.length ? `<ul class="settlement-list">${p.settlements.map((x) => `<li><strong>${dateLabel(x.date)} · ${usd(x.pnl, true)}</strong><span>回款 ${usd(x.recoveryUSD)} − 结转成本 ${usd(x.costUSD)} − 费用 ${usd(x.feeUSD)}</span>${x.native ? `<small>币本位 ${x.native.qty} ${x.native.asset} · 今日折算 ${book.prices[x.native.asset].value ? usd(mul(dec(x.native.qty), dec(book.prices[x.native.asset].value!))) : "待补充"}（非历史盈亏）</small>` : ""}</li>`).join("")}</ul>` : '<p class="muted">暂无结算。实际回收到账后，在追加流水中填写本次结转成本。</p>'}`;
}
export function metricDetail(s: ViewState, key: string): string {
  if (key === "net")
    return `<p>日期 ${esc(s.range.start || "不限")} 至 ${esc(s.range.end || "不限")}；入金减出金，费用另列。${usd(s.result.netDeposit)}</p>${entryTable(
      s.book.entries.filter(
        (e) =>
          e.kind === "cash" &&
          !e.deleted &&
          inRange(e.date, s.range.start, s.range.end),
      ),
      s.book,
    )}`;
  if (key === "realized")
    return `<p>按结算日期筛选，使用录入时的历史价格快照。以下为每笔结算来源。</p><ul class="settlement-list">${
      s.result.settlements
        .filter((x) => inRange(x.date, s.range.start, s.range.end))
        .map(
          (x) =>
            `<li>${btn(esc(`${s.book.projects.find((p) => p.id === x.projectId)?.name} · ${x.date}`), "project", "text-button", `data-id="${esc(x.projectId)}"`)}<strong>${usd(x.pnl, true)}</strong><span>回款 ${usd(x.recoveryUSD)} − 成本 ${usd(x.costUSD)} − 费用 ${usd(x.feeUSD)}</span></li>`,
        )
        .join("") || "<li>暂无结算</li>"
    }</ul>`;
  return `<p>当前数据，不受日期筛选影响。点击币种或项目查看来源。</p>${["core", "available", "reserved", "total"].includes(key) ? holdingsTable(s, true) : ""}${["valuation", "floating", "reserved", "total", "available"].includes(key) ? `<h3>项目明细</h3><ul class="settlement-list">${s.result.projects.map((p) => `<li>${btn(esc(p.project.name), "project", "text-button", `data-id="${esc(p.project.id)}"`)}<span>估值 ${usd(p.valuationUSD)} · 剩余成本 ${usd(p.basis)} · 浮动 ${usd(p.floating, true)}</span><span>占用 ${p.reserve ? `${p.reserve.qty} ${p.reserve.asset}` : "0"}</span></li>`).join("") || "<li>暂无项目</li>"}</ul>` : ""}`;
}
export function fullProject(book: Book, id: string): ProjectResult | undefined {
  return calculate(book).projects.find((p) => p.project.id === id);
}
