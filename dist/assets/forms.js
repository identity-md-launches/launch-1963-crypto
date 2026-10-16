import { ASSETS, blankInvestment, today, } from "./model.js";
import { calculate } from "./engine.js";
import { amountField, assetOptions, btn, checkbox, dialogHead, esc, field, formEnd, option, select, } from "./ui.js";
import { FIELDS } from "./csv.js";
import { str } from "./decimal.js";
function moneyGroup(label, prefix, m, book) {
    const a = m?.asset ?? "USD";
    return `<fieldset class="money-group"><legend>${label}</legend><div class="form-grid money-inputs">${select("币种", prefix + "Asset", assetOptions(a))}${amountField("数量（可留空）", prefix + "Qty", m?.qty ?? "")}${amountField("当时 USD 单价", prefix + "Price", m ? (m.price ?? "") : a === "USD" ? "1" : "", a === "USD" ? "readonly" : "")}</div><div class="field-help">${prefix === "cost" ? "实际花出，从余额扣减。" : prefix === "recovery" ? "实际到账总额，含本金与利润。" : "额外扣减一次；数量不得已含此费用。"}历史价格缺失可留空，盈亏显示待补充。${btn("使用当前价格", "snapshot-price", "text-button", `data-prefix="${prefix}"`)}</div><span class="sr-only">当前 ${a} 单价 ${esc(book.prices[a].value ?? "未设置")}</span></fieldset>`;
}
export function entryForm(book, kind, entry, projectId = "") {
    const date = entry?.date ?? today();
    const e = entry?.kind === "investment" ? entry : blankInvestment(projectId, date);
    const activeKind = kind === "opening" ? "adjustment" : kind;
    const tabs = !entry
        ? `<div class="form-tabs" role="group" aria-label="记录类型">${[
            ["investment", "投资流水"],
            ["cash", "出入金"],
            ["exchange", "币种兑换"],
            ["adjustment", "期初 / 调整"],
        ]
            .map(([k, label]) => btn(label, "entry-kind", activeKind === k ? "selected" : "", `data-kind="${k}" aria-pressed="${activeKind === k}"`))
            .join("")}</div>`
        : "";
    let body = "";
    if (kind === "investment") {
        const selected = e.projectId || book.projects[0]?.id || "new";
        const p = calculate(book).projects.find((p) => p.project.id === selected);
        body = `<div class="form-grid">${select("所属项目", "projectId", book.projects.map((p) => option(p.id, p.name, selected)).join("") + option("new", "+ 新建项目", selected))}${field("发生 / 结算日期", "date", date, "date", "required")}</div><div id="new-project-fields" ${selected === "new" ? "" : "hidden"}><div class="form-grid">${field("新项目名称", "newProjectName", "", "text", 'maxlength="120"')}${field("分类", "newCategory", "生态投资", "text", 'list="categories" maxlength="80"')}</div></div><datalist id="categories"><option>生态投资</option><option>NFT</option><option>空投</option><option>打新</option><option>质押 / 锁仓</option><option>其他</option></datalist>
    ${p
            ? `<p class="field-help">项目剩余成本：${ASSETS.filter((a) => p.remaining[a] > 0n)
                .map((a) => str(p.remaining[a]) + " " + a)
                .join(" / ") || "0"}；占用 ${p.reserve ? `${p.reserve.qty} ${p.reserve.asset}` : "0"}。编辑历史流水将重新计算后续结算。</p>`
            : ""}
    ${moneyGroup("实际投入", "cost", e.cost, book)}${moneyGroup("实际回收", "recovery", e.recovery, book)}
    <details class="form-section" ${e.recovery || e.release.length ? "open" : ""}><summary>本次结转成本 <span>部分退出、结束或损失核销时填写</span></summary><p class="field-help">填写本次回款对应的原投入数量，不会再次扣余额。留空表示本次不结转该币种本金。纯收益回款可全部留空。</p><div class="release-grid">${ASSETS.map((a) => amountField(a, "release" + a, e.release.find((r) => r.asset === a)?.qty ?? "")).join("")}</div>${btn("填入结转前全部剩余成本", "release-all", "text-button")}</details>
    <fieldset class="snapshot-fields"><legend>项目剩余权益</legend><div class="snapshot-row">${checkbox("更新占用总量", "updateReserve", !!e.reserve)}<div class="form-grid">${select("占用币种", "reserveAsset", assetOptions(e.reserve?.asset ?? "USD"))}${amountField("项目占用总数量", "reserveQty", e.reserve?.qty ?? "0")}</div><p class="field-help">这是更新后的总量，填 0 解锁；只减少可用余额。与实际成本为同一笔本金时，请勿再次占用。</p>${checkbox("本次投入与占用为不同资金（同时填写时确认）", "independentCapital", false)}</div><div class="snapshot-row">${checkbox("更新剩余未结算估值", "updateValuation", !!e.valuation || !entry)}<div class="form-grid">${select("估值币种", "valuationAsset", assetOptions(e.valuation?.asset ?? e.cost?.asset ?? "USD"))}${amountField("剩余估值（空 = 未知）", "valuationQty", e.valuation?.qty ?? "")}</div><p class="field-help">仅填写未到账权益；0 表示确认无价值，留空表示未知。部分回款必须更新此项，已回收的资金不要留在估值中。占用资金已在持仓，不要再填入估值。</p></div></fieldset>
    <details class="form-section" ${e.fee ? "open" : ""}><summary>额外手续费 <span>未包含在投入 / 回款数量中</span></summary>${moneyGroup("单列费用", "fee", e.fee, book)}${select("费用归属", "feeTreatment", option("cost", "计入本次投入成本，随结转分摊", e.feeTreatment) + option("settlement", "计入本次结算盈亏", e.feeTreatment))}</details>
    ${select("项目状态操作", "projectState", option("", "保持原状态", e.projectState ?? "") + option("active", "设为进行中 / 重新进行", e.projectState ?? "") + option("closed", "全部结算，结束项目", e.projectState ?? ""))}<p class="field-help">结束项目必须结转全部成本；确认结束后，剩余估值与占用自动清零。结束日期为本次发生日期。</p>`;
    }
    else if (kind === "cash") {
        const c = entry?.kind === "cash" ? entry : undefined;
        body = `<div class="form-grid">${field("发生日期", "date", date, "date", "required")}${select("资金方向", "direction", option("in", "入金，增加 USD", c?.direction ?? "in") + option("out", "出金，减少 USD", c?.direction ?? "in"))}${select("法币类型", "fiat", option("CNY", "人民币 CNY", c?.fiat ?? "CNY") + option("HKD", "港币 HKD", c?.fiat ?? "CNY"))}${amountField("法币金额（正数）", "fiatAmount", c?.fiatAmount ?? "", "required")}${amountField("对应 USD 总额（正数）", "usdAmount", c?.usdAmount ?? "", "required")}${amountField("额外手续费（USD）", "cashFee", c?.fee ?? "0", "required")}</div><output id="fx-preview" class="calculation-preview">成交汇率由法币金额 ÷ 对应 USD 自动计算并保存。</output><div class="form-grid">${select("实际支付币种", "payment", option("USD", "USD", c?.payment ?? "USD") + option("USDT", "USDT", c?.payment ?? "USD") + option("USDC", "USDC", c?.payment ?? "USD"))}${amountField("实际支付数量（稳定币时必填）", "paymentAmount", c?.paymentAmount ?? "")}</div><p class="field-help">报价方向：1 USD = 多少 CNY / HKD。稳定币实际数量单独保留，USD 折算由你填写的成交金额确定，不假定始终 1:1。手续费单列，避免包含在到账净额中后重复扣除。</p>`;
    }
    else if (kind === "exchange") {
        const x = entry?.kind === "exchange" ? entry : undefined;
        body = `${field("兑换日期", "date", date, "date", "required")}<fieldset><legend>换出</legend><div class="form-grid">${select("换出币种", "fromAsset", assetOptions(x?.from.asset ?? "USD"))}${amountField("换出数量（不含手续费）", "fromQty", x?.from.qty ?? "", "required")}</div></fieldset><fieldset><legend>换入</legend><div class="form-grid">${select("换入币种", "toAsset", assetOptions(x?.to.asset ?? "ETH"))}${amountField("换入数量（不含手续费）", "toQty", x?.to.qty ?? "", "required")}</div></fieldset><div class="form-grid">${select("手续费币种", "feeAsset", assetOptions(x?.fee?.asset ?? "USD"))}${amountField("额外手续费（无则留空）", "feeQty", x?.fee?.qty ?? "")}</div><div class="notice">一次兑换同时记两边余额，不改变净入金，也不增加项目盈利。请记录实际成交数量。</div>`;
    }
    else {
        const a = entry?.kind === "opening" || entry?.kind === "adjustment"
            ? entry
            : undefined;
        body = `<div class="form-grid">${select("调整类型", "adjustmentKind", option("opening", "期初余额", a?.kind ?? "opening") + option("adjustment", "余额调整", a?.kind ?? "opening"))}${field("日期", "date", date, "date", "required")}${select("币种", "asset", assetOptions(a?.asset ?? "USD"))}${amountField("数量（调整可填写负数）", "qty", a?.qty ?? "", "required")}</div>${field("原因（必填）", "reason", a?.reason ?? "", "text", 'required maxlength="1000"')}<div class="notice">期初和调整均为增量，不覆盖已有余额。例如将 5 调整为 4，应填写 −1。此记录不算入金或项目收益。</div>`;
    }
    return `${dialogHead(entry ? "编辑流水" : "记一笔", "所有币种数量单列，保存后自动重算。")}${tabs}<form id="entry-form" data-kind="${kind}" data-id="${esc(entry?.id ?? "")}">${body}<div class="form-grid">${field("账户 / 地址标签", "account", entry?.account ?? "", "text", 'maxlength="120" placeholder="例如：主账户、冷钱包"')}</div><label class="field"><span>备注</span><textarea name="note" rows="2" maxlength="4000" placeholder="只记录标签与交易说明，请勿填写私钥或助记词">${esc(entry?.note ?? "")}</textarea></label>${formEnd(entry ? "保存修改" : "保存记录")}</form>`;
}
export function projectForm(book, p) {
    return `${dialogHead(p ? "编辑项目" : "新建项目", "项目关联只作标签，所有资金通过流水记录。")}<form id="project-form" data-id="${esc(p?.id ?? "")}"><div class="form-grid">${field("项目名称", "name", p?.name ?? "", "text", 'required maxlength="120"')}${field("分类", "category", p?.category ?? "生态投资", "text", 'required maxlength="80"')}${field("账户 / 地址标签", "account", p?.account ?? "", "text", 'maxlength="120"')}${select("关联项目（可选）", "related", option("", "不关联", p?.related ?? "") +
        book.projects
            .filter((x) => x.id !== p?.id)
            .map((x) => option(x.id, x.name, p?.related ?? ""))
            .join(""))}</div><label class="field"><span>项目备注</span><textarea name="notes" rows="3" maxlength="4000">${esc(p?.notes ?? "")}</textarea></label>${formEnd("保存项目")}</form>`;
}
export function vaultForm(hasVault, mode = "open") {
    const create = mode === "create" || !hasVault;
    return `${dialogHead(mode === "change" ? "更改账本口令" : create ? "创建私密账本" : "解锁我的账本", create ? "从空账本开始，演示数据不会混入个人账本。" : "个人账本只在此浏览器保存。")}<form id="vault-form" data-mode="${mode === "change" ? "change" : create ? "create" : "open"}">${create ? field("账本名称", "name", "我的投资账本", "text", 'required maxlength="100"') : ""}${field(mode === "change" ? "新的账本口令" : "账本口令", "password", "", "password", `required minlength="${create || mode === "change" ? "10" : "1"}" autocomplete="${create || mode === "change" ? "new-password" : "current-password"}"`)}${create || mode === "change" ? field("再次输入口令", "confirm", "", "password", 'required autocomplete="new-password"') : ""}<p class="field-help">${create || mode === "change" ? "使用至少 10 位独立口令。口令不会上传或保存，遗忘后无法恢复，请妥善保管并下载加密备份。" : "输入创建时的口令。不会要求钱包私钥、助记词或交易权限。"}</p>${formEnd(create ? "创建并开始记账" : mode === "change" ? "保存新口令" : "解锁账本")}</form>${hasVault && mode === "open" ? `<div class="dialog-bottom">${btn("从加密备份恢复", "restore-backup", "text-button")}${btn("尝试上次自动副本", "previous-backup", "text-button")}</div>` : ""}`;
}
export function manualPriceForm(book, a) {
    return `${dialogHead(`设置 ${a} 手动备用价格`, "明确标记为手动价格，不影响历史结算。")}<form id="manual-price-form" data-asset="${a}">${amountField("每枚币的 USD 价格", "value", book.prices[a].value ?? "", "required")}<p class="field-help">保存时间将记为当前时间。下一次成功的市场刷新会替换手动价。</p>${formEnd("保存备用价格")}</form>`;
}
export function importForm(rows, mapping = {}, result) {
    return `${dialogHead("导入 CSV", "先映射字段并预览，通过账务校验后再导入。")}<form id="csv-form"><label class="field"><span>选择 CSV 文件（UTF-8）</span><input id="csv-file" type="file" accept=".csv,text/csv"/></label>${btn("下载字段模板", "csv-template", "text-button")}${rows
        ? `<p>已读取 ${rows.length - 1} 行。类型为空时按投资流水处理，日期必填。结转成本格式为 USD:500;ETH:0.1。</p><details class="form-section" ${result ? "" : "open"}><summary>字段映射 <span>展开调整飞书列名</span></summary><div class="mapping-grid">${Object.entries(FIELDS)
            .map(([key, label]) => select(label, "map_" + key, option("", "不导入此字段", mapping[key] ?? "") +
            rows[0]
                .map((h) => option(h, h, mapping[key] ?? ""))
                .join("")))
            .join("")}</div></details><button class="btn secondary" type="submit">重新预览并校验</button>`
        : ""}</form>${result
        ? `<div class="import-summary"><strong>新增 ${result.added} 条 · 重复跳过 ${result.duplicates} 条</strong><span>${result.errors.length ? `${result.errors.length} 项错误，尚未导入` : "账务校验通过，尚未导入"}</span></div>${result.errors.length
            ? `<ul class="form-error">${result.errors
                .slice(0, 100)
                .map((e) => `<li>${esc(e)}</li>`)
                .join("")}</ul>`
            : ""}<div class="table-wrap import-preview"><table><thead><tr><th>行</th><th>类型 / 名称</th><th>日期</th><th>金额预览</th><th>处理</th></tr></thead><tbody>${result.preview
            .slice(0, 200)
            .map((r) => `<tr><td>${r.line}</td><td>${esc(r.kind)} · ${esc(r.name)}</td><td>${esc(r.date)}</td><td>${esc(r.amount)}</td><td>${esc(r.status)}</td></tr>`)
            .join("")}</tbody></table></div><p class="field-help">预览最多显示前 200 行，校验与导入覆盖全部行；重复按 ID 或完整流水内容识别。请先核对源数据，避免将同笔出入金另作投资回款。</p><div class="dialog-actions">${btn("取消", "close", "secondary")}${btn("确认导入", "confirm-import", "primary", result.errors.length ? "disabled" : "")}</div>`
        : ""}<div id="form-error" class="form-error" role="alert" tabindex="-1" hidden></div>`;
}
export function restoreForm(previous = false) {
    return `${dialogHead(previous ? "恢复上次自动副本" : "恢复完整备份", "先解密和校验，再确认替换当前账本。")}<form id="restore-form" data-previous="${previous}">${previous ? "" : `<label class="field"><span>JSON 备份文件</span><input type="file" name="backup" accept=".json,application/json" required/></label>`}${field("备份的解锁口令（演示 JSON 可留空）", "password", "", "password", 'autocomplete="current-password"')}<p class="field-help">恢复会替换当前账本。建议先下载当前备份。原账本最近副本仍保存在本机，可通过“尝试上次自动副本”恢复。</p>${formEnd("解密并预览")}</form>`;
}
