import { ASSETS, base, emptyBook, id, today, } from "./model.js";
import { calculate } from "./engine.js";
import { dec, div, norm, str } from "./decimal.js";
import { assertBook } from "./validate.js";
import { demoBook } from "./demo.js";
import { makeSession, PREVIOUS_KEY, saveVault, unseal, VAULT_KEY, } from "./storage.js";
import { refreshPrices } from "./prices.js";
import { autoMapping, csvTemplate, exportCSV, parseCSV, previewCSV, } from "./csv.js";
import { btn, defaultFilters, dialogHead, entryAmount, entryName, esc, usd, } from "./ui.js";
import { fullProject, metricDetail, pageNames, projectDetail, shell, } from "./views.js";
import { entryForm, projectBalanceHint, importForm, manualPriceForm, projectForm, restoreForm, vaultForm, } from "./forms.js";
const app = document.querySelector("#app");
const modal = document.querySelector("#modal");
const DEMO_KEY = "shizhang.demo.v1";
let initial = demoBook(), storageError = "", hasVault = false;
try {
    hasVault = !!localStorage.getItem(VAULT_KEY);
    const demo = localStorage.getItem(DEMO_KEY);
    if (demo) {
        const raw = JSON.parse(demo);
        assertBook(raw);
        initial = raw;
    }
}
catch {
    storageError =
        "浏览器保存不可用或演示缓存损坏。请检查存储设置；不要在此状态录入真实数据。";
}
let s = {
    book: initial,
    result: calculate(initial),
    page: "dashboard",
    demo: true,
    locked: true,
    hasVault,
    filters: defaultFilters(),
    range: { start: "", end: "" },
    chart: "core",
    refreshing: false,
    savedAt: "",
    storageError,
};
let session = null, saving = false, timer, trigger = null, toastTimer;
let csvRows, mapping = {}, importResult, importRevision = -1;
let restoreCandidate;
let lastActivity = Date.now();
function notify(message) {
    const el = document.querySelector("#toast");
    el.textContent = message;
    el.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visible"), 5000);
}
function render() {
    const active = document.activeElement;
    const action = active?.dataset.action, entity = active?.dataset.id, asset = active?.dataset.asset, focusId = active?.id;
    s.result = calculate(s.book, s.range);
    app.innerHTML = shell(s);
    if (modal.open)
        return;
    if (focusId)
        document.getElementById(focusId)?.focus({ preventScroll: true });
    else if (action) {
        const match = [...app.querySelectorAll("[data-action]")].find((e) => e.dataset.action === action &&
            e.dataset.id === entity &&
            e.dataset.asset === asset);
        match?.focus({ preventScroll: true });
    }
}
function open(html, wide = false) {
    if (!modal.open)
        trigger = document.activeElement;
    modal.innerHTML = html;
    modal.className = wide ? "wide" : "";
    if (!modal.open)
        modal.showModal();
    const target = modal.querySelector('input:not([type="checkbox"]):not([type="file"]),select');
    if (target)
        target.focus();
}
function close() {
    if (saving)
        return;
    modal.close();
    modal.innerHTML = "";
    trigger?.focus();
}
function formFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    const target = modal.open
        ? modal.querySelector("#form-error")
        : null;
    if (target) {
        target.hidden = false;
        target.textContent = message;
        target.focus();
    }
    else
        notify(message);
}
function changePage() {
    const keyboardNavigation = document.activeElement?.matches("a:focus-visible");
    const page = location.hash.slice(1);
    s.page = Object.hasOwn(pageNames, page) ? page : "dashboard";
    render();
    if (keyboardNavigation) {
        const heading = document.querySelector("#main h1");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
}
function audit(next, action, entityId, before, after) {
    next.audit.push({
        at: new Date().toISOString(),
        action,
        entityId,
        before: structuredClone(before),
        after: structuredClone(after),
    });
}
async function commit(next, message, closeAfter = true) {
    if (saving)
        throw new Error("正在保存，请稍后再试");
    assertBook(next);
    const priceScheduleChanged = next.id !== s.book.id ||
        next.settings.auto !== s.book.settings.auto ||
        next.settings.interval !== s.book.settings.interval;
    saving = true;
    modal
        .querySelectorAll('button[type="submit"]')
        .forEach((b) => {
        b.disabled = true;
        b.dataset.oldLabel = b.textContent ?? "";
        b.textContent = "正在保存…";
    });
    try {
        next.revision = s.book.revision + 1;
        if (s.demo)
            localStorage.setItem(DEMO_KEY, JSON.stringify(next));
        else {
            if (!session)
                throw new Error("账本已锁定，请重新解锁");
            await saveVault(next, session);
        }
        s.book = next;
        s.savedAt = new Date().toISOString();
        s.storageError = "";
        saving = false;
        if (closeAfter)
            close();
        render();
        notify(message);
        if (priceScheduleChanged)
            setupPriceTimer();
    }
    finally {
        saving = false;
        modal
            .querySelectorAll('button[type="submit"]')
            .forEach((b) => {
            b.disabled = false;
            if (b.dataset.oldLabel)
                b.textContent = b.dataset.oldLabel;
        });
    }
}
function download(filename, content, type = "application/json") {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function backup() {
    const name = `拾账-${s.demo ? "虚构演示" : "加密备份"}-${today()}`;
    if (s.demo) {
        download(name + ".json", JSON.stringify(s.book, null, 2));
        notify("已下载虚构演示数据；个人账本使用加密备份");
    }
    else {
        const raw = localStorage.getItem(VAULT_KEY);
        if (!raw)
            throw new Error("找不到已保存账本");
        download(name + ".json", raw);
        notify("加密备份已下载，请妥善保存口令");
    }
}
function lock() {
    if (saving) {
        notify("正在保存，完成后请再锁定");
        return;
    }
    session = null;
    s.demo = true;
    s.locked = true;
    s.hasVault = !!localStorage.getItem(VAULT_KEY);
    s.book = demoBook();
    s.range = { start: "", end: "" };
    s.filters = defaultFilters();
    s.savedAt = "";
    close();
    render();
    setupPriceTimer();
    notify("个人账本已锁定，现在显示虚构演示");
}
async function refresh() {
    if (s.refreshing || saving)
        return;
    const bookId = s.book.id, wasDemo = s.demo;
    s.refreshing = true;
    render();
    const nextPrices = await refreshPrices(s.book.prices);
    if (s.book.id !== bookId || s.demo !== wasDemo) {
        s.refreshing = false;
        render();
        return;
    }
    try {
        const next = structuredClone(s.book);
        for (const a of ASSETS)
            next.prices[a] = nextPrices[a].error
                ? { ...next.prices[a], error: nextPrices[a].error }
                : nextPrices[a];
        const errors = ASSETS.filter((a) => next.prices[a].error).length;
        await commit(next, errors
            ? `${errors} 个币种更新失败，已保留上次价格`
            : "行情已更新，历史结算保持不变", false);
    }
    catch (e) {
        formFailure(e);
    }
    finally {
        s.refreshing = false;
        render();
    }
}
function setupPriceTimer() {
    clearInterval(timer);
    if (s.book.settings.auto)
        timer = setInterval(() => {
            if (!document.hidden)
                void refresh();
        }, s.book.settings.interval * 60000);
}
function getEntry(entryId) {
    const entry = s.book.entries.find((e) => e.id === entryId);
    if (!entry)
        throw new Error("记录不存在，请刷新页面");
    return entry;
}
function entryDetail(e) {
    const historical = e.kind === "investment"
        ? `<dl class="detail-definition"><div><dt>投入历史单价</dt><dd>${e.cost ? `${e.cost.price ?? "待补充"} USD / ${e.cost.asset}` : "无"}</dd></div><div><dt>结算历史单价</dt><dd>${e.recovery ? `${e.recovery.price ?? "待补充"} USD / ${e.recovery.asset}` : "无"}</dd></div><div><dt>本次结转成本</dt><dd>${e.release.map((r) => r.qty + " " + r.asset).join(" / ") || "0"}</dd></div><div><dt>占用快照</dt><dd>${e.reserve ? `${e.reserve.qty} ${e.reserve.asset}` : "保持原值"}</dd></div><div><dt>剩余估值快照</dt><dd>${e.valuation ? `${e.valuation.qty ?? "未知"} ${e.valuation.asset}` : "保持原值"}</dd></div><div><dt>额外费用</dt><dd>${e.fee ? `${e.fee.qty} ${e.fee.asset}；历史单价 ${e.fee.price ?? "待补充"} USD；${e.feeTreatment === "cost" ? "计入成本" : "本次结算费用"}` : "0"}</dd></div></dl>`
        : "";
    open(`${dialogHead(entryName(e, s.book), `${e.date} · ${e.deleted ? "已撤销" : "已记录"}`)}<p class="detail-amount">${esc(entryAmount(e))}</p>${historical}<p>账户：${esc(e.account || "未标记")}</p><p class="note-text">${esc(e.note || "无备注")}</p><details class="form-section"><summary>原始记录（可追溯）</summary><pre>${esc(JSON.stringify(e, null, 2))}</pre></details><div class="dialog-actions">${btn("关闭", "close", "secondary")}${e.deleted ? btn("恢复记录", "restore", "primary", `data-id="${esc(e.id)}"`) : btn("编辑记录", "edit-entry", "primary", `data-id="${esc(e.id)}"`)}</div>`, true);
}
function sourceDetail(asset) {
    const r = calculate(s.book), h = r.holdings[asset];
    open(`${dialogHead(`${asset} 余额来源`, "当前数据；占用不扣总余额，估值不进入可用余额。")}<div class="detail-stats"><div><span>当前数量</span><strong>${str(h.qty)}</strong></div><div><span>可用数量</span><strong>${str(h.available)}</strong></div><div><span>占用数量</span><strong>${str(h.reserved)}</strong></div><div><span>当前持仓价值</span><strong>${usd(h.value)}</strong></div></div><h3>余额流水</h3><ul class="settlement-list">${h.sources.map((x) => `<li>${btn(esc(x.label), "entry", "text-button", `data-id="${esc(x.entryId)}"`)}<span>${x.date} · ${x.delta > 0n ? "+" : ""}${str(x.delta)} ${asset}</span></li>`).join("") || "<li>尚无余额流水</li>"}</ul><h3>占用来源</h3><ul class="settlement-list">${r.projects
        .filter((p) => p.reserve?.asset === asset && dec(p.reserve.qty) > 0n)
        .map((p) => `<li>${btn(esc(p.project.name), "project", "text-button", `data-id="${esc(p.project.id)}"`)}<strong>${p.reserve?.qty} ${asset}</strong></li>`)
        .join("") || "<li>当前无占用</li>"}</ul><h3>项目剩余估值</h3><ul class="settlement-list">${r.projects
        .filter((p) => p.valuation?.asset === asset)
        .map((p) => `<li>${btn(esc(p.project.name), "project", "text-button", `data-id="${esc(p.project.id)}"`)}<span>${p.valuation?.qty ?? "待补充"} ${asset} · ${usd(p.valuationUSD)}</span></li>`)
        .join("") || "<li>当前无项目估值</li>"}</ul>`, true);
}
function values(form) {
    const data = new FormData(form);
    return {
        get: (name) => String(data.get(name) ?? "").trim(),
        has: (name) => data.has(name),
        data,
    };
}
async function saveEntry(form) {
    const { get, has } = values(form);
    const kind = form.dataset.kind;
    const existing = form.dataset.id ? getEntry(form.dataset.id) : null;
    const next = structuredClone(s.book);
    const common = {
        ...base(get("date")),
        id: existing?.id ?? id(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        account: get("account"),
        note: get("note"),
        deleted: existing?.deleted ?? false,
    };
    const money = (prefix, historical = false, zero = false) => {
        const value = get(prefix + "Qty");
        if (!value)
            return null;
        const q = norm(value);
        if (!zero && dec(q) === 0n)
            return null;
        const a = get(prefix + "Asset");
        const price = a === "USD"
            ? "1"
            : get(prefix + "Price")
                ? norm(get(prefix + "Price"))
                : null;
        return { asset: a, qty: q, price: historical ? price : null };
    };
    const simple = (prefix) => {
        const m = money(prefix);
        return m ? { asset: m.asset, qty: m.qty } : null;
    };
    let entry;
    if (kind === "investment") {
        let projectId = get("projectId");
        if (projectId === "new") {
            const p = {
                id: id(),
                name: get("newProjectName"),
                category: get("newCategory"),
                account: get("account"),
                related: null,
                notes: "",
                createdAt: new Date().toISOString(),
            };
            next.projects.push(p);
            projectId = p.id;
            audit(next, "新建项目", p.id, null, p);
        }
        const cost = money("cost", true), reserveRaw = has("updateReserve") ? money("reserve", false, true) : null;
        if (has("updateReserve") && !reserveRaw)
            throw new Error("更新占用时请输入总数量，解锁请填 0");
        if (cost &&
            reserveRaw &&
            dec(reserveRaw.qty) > 0n &&
            !has("independentCapital"))
            throw new Error("实际成本和占用不能处理同一笔本金。若是不同资金，请勾选确认。");
        const recovery = money("recovery", true), fee = money("fee", true);
        const release = ASSETS.filter((a) => get("release" + a) && dec(get("release" + a)) !== 0n).map((a) => ({ asset: a, qty: norm(get("release" + a)) }));
        entry = {
            ...common,
            kind: "investment",
            projectId,
            cost,
            recovery,
            release,
            fee,
            feeTreatment: fee
                ? get("feeTreatment")
                : cost
                    ? "cost"
                    : "settlement",
            reserve: reserveRaw
                ? { asset: reserveRaw.asset, qty: reserveRaw.qty }
                : null,
            valuation: has("updateValuation")
                ? {
                    asset: get("valuationAsset"),
                    qty: get("valuationQty") ? norm(get("valuationQty")) : null,
                }
                : null,
            projectState: (get("projectState") || null),
        };
        if (entry.projectState === "closed" &&
            !confirm("确认全部结算并结束项目？剩余估值与占用将自动清零，未结转成本必须已处理。"))
            return;
    }
    else if (kind === "cash") {
        const usd = norm(get("usdAmount")), fiat = norm(get("fiatAmount"));
        const payment = get("payment");
        entry = {
            ...common,
            kind: "cash",
            direction: get("direction"),
            fiat: get("fiat"),
            fiatAmount: fiat,
            usdAmount: usd,
            rate: str(div(dec(fiat), dec(usd))),
            fee: norm(get("cashFee") || "0"),
            payment,
            paymentAmount: payment === "USD" ? usd : norm(get("paymentAmount")),
        };
    }
    else if (kind === "exchange")
        entry = {
            ...common,
            kind: "exchange",
            from: simple("from"),
            to: simple("to"),
            fee: simple("fee"),
        };
    else
        entry = {
            ...common,
            kind: get("adjustmentKind"),
            asset: get("asset"),
            qty: norm(get("qty")),
            reason: get("reason"),
        };
    if (existing)
        next.entries[next.entries.findIndex((e) => e.id === existing.id)] = entry;
    else
        next.entries.push(entry);
    audit(next, existing ? "编辑流水" : "新增流水", entry.id, existing, entry);
    await commit(next, existing ? "修改已保存，关联账务已重算" : "记录已保存，持仓与仪表盘已更新");
}
async function toggleDeleted(entryId, deleted) {
    const old = getEntry(entryId);
    if (deleted &&
        !confirm(`撤销“${entryName(old, s.book)}”这笔记录？其余额和盈亏影响会移除，原记录保留，可在数据管理中恢复。`))
        return;
    const next = structuredClone(s.book), entry = next.entries.find((e) => e.id === entryId);
    entry.deleted = deleted;
    audit(next, deleted ? "撤销流水" : "恢复流水", entryId, old, entry);
    await commit(next, deleted ? "记录已撤销，可在数据管理中恢复" : "记录已恢复，所有汇总已重算");
}
async function saveProject(form) {
    const { get } = values(form), pid = form.dataset.id;
    const old = s.book.projects.find((p) => p.id === pid) ?? null;
    const p = {
        id: old?.id ?? id(),
        name: get("name"),
        category: get("category"),
        account: get("account"),
        related: get("related") || null,
        notes: get("notes"),
        createdAt: old?.createdAt ?? new Date().toISOString(),
    };
    const next = structuredClone(s.book);
    if (old)
        next.projects[next.projects.findIndex((x) => x.id === p.id)] = p;
    else
        next.projects.push(p);
    audit(next, old ? "编辑项目" : "新建项目", p.id, old, p);
    await commit(next, "项目资料已保存");
}
async function handleVault(form) {
    const { get } = values(form), mode = form.dataset.mode;
    if (mode === "open") {
        const raw = localStorage.getItem(VAULT_KEY);
        if (!raw)
            throw new Error("没有找到本机账本，请从备份恢复");
        const opened = await unseal(raw, get("password"));
        s.book = opened.book;
        session = opened.session;
        s.demo = false;
        s.locked = false;
        s.storageError = "";
        s.range = { start: "", end: "" };
        s.filters = defaultFilters();
        close();
        render();
        setupPriceTimer();
        notify("账本已解锁");
        lastActivity = Date.now();
        return;
    }
    if (get("password") !== get("confirm"))
        throw new Error("两次口令不一致，请重新输入");
    if (mode === "change" && (s.demo || !session))
        throw new Error("请先解锁个人账本，再更改口令");
    // Keep the version belonging to this in-memory book, before any async work.
    // A new vault must still have no predecessor when saveVault holds the lock.
    const previous = mode === "change" ? session.previous : null;
    const book = mode === "change" ? structuredClone(s.book) : emptyBook();
    if (mode === "create")
        book.name = get("name");
    assertBook(book);
    if (mode === "change")
        audit(book, "更改加密口令", book.id, null, null);
    saving = true;
    let newSession;
    try {
        newSession = await makeSession(get("password"));
        newSession.previous = previous;
        await saveVault(book, newSession);
    }
    finally {
        saving = false;
    }
    session = newSession;
    s.book = book;
    s.demo = false;
    s.hasVault = true;
    s.locked = false;
    s.storageError = "";
    s.filters = defaultFilters();
    s.range = { start: "", end: "" };
    s.savedAt = new Date().toISOString();
    lastActivity = Date.now();
    close();
    render();
    if (mode !== "change")
        setupPriceTimer();
    notify(mode === "change"
        ? "口令已更新，请下载新的加密备份"
        : "私密账本已创建，从期初余额或入金开始");
}
function showImport() {
    open(importForm(csvRows, mapping, importResult), true);
}
async function prepareRestore(form) {
    const { get, data } = values(form);
    let raw;
    if (form.dataset.previous === "true") {
        const prev = localStorage.getItem(PREVIOUS_KEY);
        if (!prev)
            throw new Error("暂无上次自动副本");
        raw = prev;
    }
    else {
        const file = data.get("backup");
        if (!(file instanceof File) || !file.size)
            throw new Error("请选择加密备份文件");
        if (file.size > 20_000_000)
            throw new Error("文件超过 20 MB");
        raw = await file.text();
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "schema" in parsed) {
        assertBook(parsed);
        if (!s.demo || parsed.id !== "demo-book")
            throw new Error("明文 JSON 仅可恢复虚构演示账本。个人账本请使用加密备份或映射导入 CSV。");
        restoreCandidate = { book: parsed, session: null };
    }
    else
        restoreCandidate = await unseal(raw, get("password"));
    const b = restoreCandidate.book;
    open(`${dialogHead("确认恢复备份", "恢复后，当前本机账本将被替换。")}<dl class="detail-definition"><div><dt>账本</dt><dd>${esc(b.name)}</dd></div><div><dt>记录</dt><dd>${b.entries.length} 条流水，${b.projects.length} 个项目</dd></div><div><dt>校验</dt><dd>结构和账务重算均通过</dd></div></dl><p>解锁当前账本时恢复，会沿用当前口令；从锁定状态恢复，则使用这份备份的口令。</p><div class="dialog-actions">${btn("取消", "close", "secondary")}${btn("替换并恢复账本", "confirm-restore", "primary")}</div><div id="form-error" class="form-error" role="alert" tabindex="-1" hidden></div>`);
}
async function handleAction(el) {
    const action = el.dataset.action, entryId = el.dataset.id ?? "";
    switch (action) {
        case "close":
            close();
            break;
        case "new":
            open(entryForm(s.book, "investment"));
            break;
        case "new-cash":
            open(entryForm(s.book, "cash"));
            break;
        case "new-exchange":
            open(entryForm(s.book, "exchange"));
            break;
        case "new-adjustment":
            open(entryForm(s.book, "adjustment"));
            break;
        case "entry-kind": {
            const form = modal.querySelector("#entry-form");
            if (form &&
                [...form.querySelectorAll('input[type="text"]')].some((i) => i.value &&
                    i.name !== "newCategory" &&
                    !i.name.endsWith("Price") &&
                    !["reserveQty"].includes(i.name)) &&
                !confirm("切换记录类型将清空当前未保存表单，继续切换？"))
                return;
            open(entryForm(s.book, el.dataset.kind));
            break;
        }
        case "edit-entry": {
            const e = getEntry(entryId);
            open(entryForm(s.book, e.kind, e));
            break;
        }
        case "entry":
            entryDetail(getEntry(entryId));
            break;
        case "delete":
            await toggleDeleted(entryId, true);
            break;
        case "restore":
            await toggleDeleted(entryId, false);
            break;
        case "new-project":
            open(projectForm(s.book));
            break;
        case "edit-project":
            open(projectForm(s.book, s.book.projects.find((p) => p.id === entryId)));
            break;
        case "new-project-entry":
            open(entryForm(s.book, "investment", undefined, entryId));
            break;
        case "project": {
            const p = fullProject(s.book, entryId);
            if (p)
                open(dialogHead(p.project.name, "项目全周期汇总，不受仪表盘日期筛选影响。") + projectDetail(p, s.book), true);
            break;
        }
        case "sources":
            sourceDetail(el.dataset.asset);
            break;
        case "metric":
            open(dialogHead("汇总来源", "每一项都可以追溯到原始流水。") +
                metricDetail(s, el.dataset.metric ?? ""), true);
            break;
        case "filter-reset":
            s.filters = defaultFilters();
            render();
            break;
        case "range-reset":
            s.range = { start: "", end: "" };
            render();
            break;
        case "refresh":
            await refresh();
            break;
        case "manual-price":
            open(manualPriceForm(s.book, el.dataset.asset));
            break;
        case "backup":
            backup();
            break;
        case "vault":
            open(vaultForm(s.hasVault));
            break;
        case "change-password":
            open(vaultForm(true, "change"));
            break;
        case "lock":
            lock();
            break;
        case "export-csv":
            if (s.demo ||
                confirm("CSV 是未加密明文，包含所有项目与流水。确认下载到当前设备？")) {
                download(`拾账-${today()}.csv`, exportCSV(s.book), "text/csv;charset=utf-8");
                notify("CSV 已导出");
            }
            break;
        case "csv-template":
            download("拾账-导入模板.csv", csvTemplate(), "text/csv;charset=utf-8");
            break;
        case "import":
            csvRows = undefined;
            mapping = {};
            importResult = undefined;
            showImport();
            break;
        case "confirm-import":
            if (importResult && !importResult.errors.length) {
                if (importRevision !== s.book.revision)
                    throw new Error("预览后账本有变动，请重新预览");
                const next = importResult.book;
                audit(next, `导入 CSV：${importResult.added} 条，跳过 ${importResult.duplicates} 条`, next.id, null, null);
                await commit(next, "CSV 已导入，全部页面已更新");
            }
            break;
        case "restore-backup":
            open(restoreForm());
            break;
        case "previous-backup":
            open(restoreForm(true));
            break;
        case "confirm-restore": {
            if (!restoreCandidate)
                return;
            if (!confirm("确认替换本机账本？请确保已保存当前备份。"))
                return;
            const replacement = restoreCandidate;
            if (!replacement.session) {
                if (!s.demo)
                    throw new Error("请先锁定个人账本，再恢复演示数据");
                await commit(replacement.book, "虚构演示备份已恢复，个人账本不受影响");
                restoreCandidate = undefined;
                break;
            }
            const targetSession = !s.demo && session ? session : replacement.session;
            targetSession.previous = localStorage.getItem(VAULT_KEY);
            audit(replacement.book, "恢复完整备份", replacement.book.id, null, null);
            replacement.book.revision++;
            saving = true;
            try {
                await saveVault(replacement.book, targetSession);
            }
            finally {
                saving = false;
            }
            session = targetSession;
            s.book = replacement.book;
            s.demo = false;
            s.locked = false;
            s.hasVault = true;
            restoreCandidate = undefined;
            s.range = { start: "", end: "" };
            s.filters = defaultFilters();
            close();
            render();
            setupPriceTimer();
            notify("备份已恢复，请核对账本");
            break;
        }
        case "audit": {
            const a = s.book.audit[Number(el.dataset.index)];
            if (a)
                open(`${dialogHead(a.action, a.at)}<h3>修改前</h3><pre>${esc(JSON.stringify(a.before, null, 2))}</pre><h3>修改后</h3><pre>${esc(JSON.stringify(a.after, null, 2))}</pre><p class="field-help">完整历史随加密备份保存。价格与设置动作只记录动作名称，不记录口令。</p>`, true);
            break;
        }
        case "snapshot-price": {
            const form = modal.querySelector("#entry-form"), prefix = el.dataset.prefix;
            const { get } = values(form);
            const a = get(prefix + "Asset");
            const p = s.book.prices[a];
            if (!p.value)
                throw new Error("当前价格尚未设置，请填写当时的实际 USD 单价");
            if (get("date") !== today() &&
                !confirm("这是一笔历史记录。当前价格可能不等于当时成交价格，确认将当前价格作为本条手动快照？"))
                return;
            const input = form.elements.namedItem(prefix + "Price");
            input.value = p.value;
            notify("已填入价格快照；保存前请核对实际成交价");
            break;
        }
        case "release-all": {
            const form = modal.querySelector("#entry-form");
            const { get } = values(form);
            const old = form.dataset.id ? getEntry(form.dataset.id) : null;
            const b = structuredClone(s.book);
            b.entries = b.entries.filter((e) => e.id !== old?.id &&
                (e.date < get("date") ||
                    (e.date === get("date") &&
                        e.createdAt <= (old?.createdAt ?? new Date().toISOString()))));
            const p = calculate(b).projects.find((p) => p.project.id === get("projectId"));
            for (const a of ASSETS) {
                let q = p?.remaining[a] ?? 0n;
                if (get("costAsset") === a && get("costQty"))
                    q += dec(get("costQty"));
                form.elements.namedItem("release" + a).value =
                    q > 0n ? str(q) : "";
            }
            notify("已填写本条结算前的剩余成本，请核对");
            break;
        }
    }
}
document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (target) {
        event.preventDefault();
        if (target instanceof HTMLButtonElement && target.disabled)
            return;
        void handleAction(target).catch(formFailure);
    }
});
document.addEventListener("submit", (event) => {
    const form = event.target;
    event.preventDefault();
    if (saving || form.dataset.busy === "true")
        return;
    form.dataset.busy = "true";
    const handler = async () => {
        if (form.id === "entry-form")
            return saveEntry(form);
        if (form.id === "project-form")
            return saveProject(form);
        if (form.id === "vault-form")
            return handleVault(form);
        if (form.id === "restore-form")
            return prepareRestore(form);
        const { get, has } = values(form);
        if (form.id === "filter-form") {
            if (get("start") && get("end") && get("start") > get("end"))
                throw new Error("开始日期不能晚于结束日期");
            s.filters = {
                search: get("search"),
                project: get("project"),
                category: get("category"),
                status: get("status"),
                asset: get("asset"),
                account: get("account"),
                start: get("start"),
                end: get("end"),
                sort: get("sort"),
                deleted: has("deleted") || get("status") === "deleted",
            };
            render();
        }
        else if (form.id === "range-form") {
            if (get("start") && get("end") && get("start") > get("end"))
                throw new Error("开始日期不能晚于结束日期");
            s.range = { start: get("start"), end: get("end") };
            render();
        }
        else if (form.id === "price-settings") {
            const next = structuredClone(s.book);
            next.settings = { interval: Number(get("interval")), auto: has("auto") };
            audit(next, "修改行情设置", next.id, null, null);
            await commit(next, "更新设置已保存", false);
        }
        else if (form.id === "manual-price-form") {
            const next = structuredClone(s.book), a = form.dataset.asset;
            const value = norm(get("value"));
            if (dec(value) <= 0n)
                throw new Error("备用价格必须大于零");
            next.prices[a] = {
                value,
                at: new Date().toISOString(),
                source: "manual",
                error: null,
            };
            audit(next, `设置 ${a} 手动备用价格：${value} USD`, next.id, null, null);
            await commit(next, "备用价格已保存，当前价值已更新");
        }
        else if (form.id === "csv-form" && csvRows) {
            mapping = {};
            for (const [key, val] of new FormData(form))
                if (key.startsWith("map_") && val)
                    mapping[key.slice(4)] = String(val);
            importResult = previewCSV(csvRows, mapping, s.book);
            importRevision = s.book.revision;
            showImport();
        }
    };
    void handler()
        .catch(formFailure)
        .finally(() => {
        delete form.dataset.busy;
    });
});
document.addEventListener("change", (event) => {
    const input = event.target;
    if (input.id === "chart-mode") {
        s.chart = input.value;
        render();
    }
    if (input.name === "projectId") {
        const group = modal.querySelector("#new-project-fields");
        if (group)
            group.hidden = input.value !== "new";
        const hint = modal.querySelector("#project-balance-hint");
        if (hint) {
            hint.textContent = projectBalanceHint(s.book, input.value);
            hint.hidden = !hint.textContent;
        }
    }
    if (["costAsset", "recoveryAsset", "feeAsset"].includes(input.name)) {
        const price = modal.querySelector(`[name="${input.name.replace("Asset", "Price")}"]`);
        if (price) {
            price.value = input.value === "USD" ? "1" : "";
            price.readOnly = input.value === "USD";
        }
    }
    if (input.id === "csv-file")
        void (async () => {
            const file = input.files?.[0];
            if (!file)
                return;
            if (file.size > 10_000_000)
                throw new Error("CSV 超过 10 MB，请分批");
            csvRows = parseCSV(await file.text());
            mapping = autoMapping(csvRows[0]);
            importResult = previewCSV(csvRows, mapping, s.book);
            importRevision = s.book.revision;
            showImport();
        })().catch(formFailure);
});
document.addEventListener("input", (event) => {
    const input = event.target;
    const form = input.closest("form");
    if (form?.dataset.kind === "cash") {
        const out = form.querySelector("#fx-preview");
        if (out) {
            try {
                const { get } = values(form);
                const fiat = dec(get("fiatAmount")), usd = dec(get("usdAmount"));
                out.textContent = `1 USD = ${str(div(fiat, usd))} ${get("fiat")}；余额变化 ${str((get("direction") === "in" ? usd : -usd) - dec(get("cashFee") || "0"))} USD`;
            }
            catch {
                out.textContent =
                    "填写正数成交金额，系统将计算历史汇率与实际余额变化。";
            }
        }
    }
});
window.addEventListener("hashchange", changePage);
window.addEventListener("beforeunload", (event) => {
    if (saving) {
        event.preventDefault();
        event.returnValue = "";
    }
});
window.addEventListener("storage", (event) => {
    if (event.key === VAULT_KEY && !s.demo) {
        s.storageError =
            "另一个标签页已修改账本。请锁定并重新解锁后继续，当前未保存表单可先复制。";
        render();
    }
});
for (const name of ["pointerdown", "keydown"])
    document.addEventListener(name, () => (lastActivity = Date.now()), {
        passive: true,
    });
setInterval(() => {
    if (!s.demo && !saving && Date.now() - lastActivity > 15 * 60000)
        lock();
}, 30000);
modal.addEventListener("cancel", (event) => {
    if (saving)
        event.preventDefault();
});
modal.addEventListener("close", () => {
    modal.innerHTML = "";
    trigger?.focus();
});
changePage();
setupPriceTimer();
