import { ASSETS, base, blankInvestment, id, } from "./model.js";
import { norm, dec, div, str } from "./decimal.js";
import { assertBook } from "./validate.js";
import { entryAmount } from "./ui.js";
export const FIELDS = {
    kind: "类型",
    id: "流水ID",
    date: "日期",
    projectId: "项目ID",
    project: "项目名称",
    category: "分类",
    account: "账户",
    related: "关联项目ID",
    projectNotes: "项目备注",
    note: "备注",
    state: "项目状态",
    deleted: "已撤销",
    createdAt: "创建时间",
    costAsset: "成本币种",
    costQty: "成本数量",
    costPrice: "成本历史USD单价",
    recoveryAsset: "回收币种",
    recoveryQty: "回收数量",
    recoveryPrice: "结算历史USD单价",
    release: "本次结转成本",
    feeAsset: "手续费币种",
    feeQty: "手续费数量",
    feePrice: "手续费历史USD单价",
    feeTreatment: "费用归属",
    reserveAsset: "占用币种",
    reserveQty: "占用总数量",
    valuationAsset: "估值币种",
    valuationQty: "剩余估值",
    direction: "出入金方向",
    fiat: "法币类型",
    fiatAmount: "法币金额",
    usdAmount: "对应USD金额",
    payment: "实际支付币种",
    paymentAmount: "实际支付数量",
    fromAsset: "换出币种",
    fromQty: "换出数量",
    toAsset: "换入币种",
    toQty: "换入数量",
    asset: "调整币种",
    qty: "调整数量",
    reason: "调整原因",
    escaped: "CSV文本转义列",
};
const kindNames = {
    investment: "投资",
    cash: "出入金",
    exchange: "兑换",
    opening: "期初",
    adjustment: "调整",
    project: "项目",
};
export function parseCSV(text) {
    if (text.length > 10_000_000)
        throw new Error("CSV 超过 10 MB，请分批导入");
    const rows = [];
    let row = [], cell = "", quoted = false, afterQuote = false;
    const input = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (quoted) {
            if (c === '"' && input[i + 1] === '"') {
                cell += '"';
                i++;
            }
            else if (c === '"') {
                quoted = false;
                afterQuote = true;
            }
            else
                cell += c;
        }
        else if (c === '"') {
            if (cell || afterQuote)
                throw new Error(`CSV 第 ${rows.length + 1} 行引号格式错误`);
            quoted = true;
        }
        else if (c === "," || c === "\n" || c === "\r") {
            row.push(cell);
            cell = "";
            afterQuote = false;
            if (c !== ",") {
                if (c === "\r" && input[i + 1] === "\n")
                    i++;
                if (row.some((x) => x.trim()))
                    rows.push(row);
                row = [];
            }
        }
        else {
            if (afterQuote)
                throw new Error(`CSV 第 ${rows.length + 1} 行引号后存在额外字符`);
            cell += c;
        }
    }
    if (quoted)
        throw new Error("CSV 引号未闭合");
    row.push(cell);
    if (row.some((x) => x.trim()))
        rows.push(row);
    if (rows.length < 2)
        throw new Error("CSV 需含表头和至少一条数据");
    if (new Set(rows[0]).size !== rows[0].length)
        throw new Error("CSV 表头重复，请改为唯一名称");
    if (rows.some((r) => r.length !== rows[0].length))
        throw new Error("CSV 行列数不一致，请检查逗号或使用双引号包住备注");
    if (rows.length > 50001)
        throw new Error("请按不超过 50,000 行分批导入");
    return rows;
}
export function autoMapping(headers) {
    const mapping = {};
    for (const [key, label] of Object.entries(FIELDS)) {
        const found = headers.find((h) => h === label || h === key);
        if (found)
            mapping[key] = found;
    }
    const aliases = {
        date: ["投入日期", "发生日期", "交易日期"],
        costQty: ["投入数量", "成本"],
        recoveryQty: ["实际回收", "回款数量"],
        account: ["账户／地址标签"],
        project: ["项目", "名称"],
        valuationQty: ["剩余未结算估值"],
    };
    for (const [key, names] of Object.entries(aliases))
        if (!mapping[key])
            mapping[key] = headers.find((h) => names.includes(h));
    return mapping;
}
function projectColumns(p) {
    return {
        projectId: p.id,
        project: p.name,
        category: p.category,
        account: p.account,
        related: p.related ?? "",
        projectNotes: p.notes,
        createdAt: p.createdAt,
    };
}
export function entryColumns(e, book) {
    const data = {
        kind: kindNames[e.kind],
        id: e.id,
        date: e.date,
        account: e.account,
        note: e.note,
        deleted: String(e.deleted),
        createdAt: e.createdAt,
    };
    const setMoney = (prefix, m) => {
        if (m) {
            data[prefix + "Asset"] = m.asset;
            data[prefix + "Qty"] = m.qty;
            if ("price" in m)
                data[prefix + "Price"] = m.price ?? "";
        }
    };
    if (e.kind === "investment") {
        const p = book.projects.find((p) => p.id === e.projectId);
        Object.assign(data, projectColumns(p), {
            account: e.account,
            createdAt: e.createdAt,
        });
        setMoney("cost", e.cost);
        setMoney("recovery", e.recovery);
        setMoney("fee", e.fee);
        setMoney("reserve", e.reserve);
        if (e.valuation) {
            data.valuationAsset = e.valuation.asset;
            data.valuationQty = e.valuation.qty ?? "未知";
        }
        data.release = e.release.map((r) => `${r.asset}:${r.qty}`).join(";");
        data.feeTreatment = e.feeTreatment;
        data.state = e.projectState ?? "";
    }
    else if (e.kind === "cash")
        Object.assign(data, {
            direction: e.direction,
            fiat: e.fiat,
            fiatAmount: e.fiatAmount,
            usdAmount: e.usdAmount,
            feeQty: e.fee,
            feeAsset: "USD",
            payment: e.payment,
            paymentAmount: e.paymentAmount,
        });
    else if (e.kind === "exchange") {
        setMoney("from", e.from);
        setMoney("to", e.to);
        setMoney("fee", e.fee);
    }
    else
        Object.assign(data, { asset: e.asset, qty: e.qty, reason: e.reason });
    return data;
}
export function exportCSV(book) {
    const keys = Object.keys(FIELDS);
    const rows = [
        ...book.projects.map((p) => ({ ...projectColumns(p), kind: "项目" })),
        ...book.entries.map((e) => entryColumns(e, book)),
    ];
    const needsEscape = (s) => /^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?\d+(\.\d+)?$/.test(s));
    const quote = (s) => '"' + s.replace(/"/g, '""') + '"';
    return ("\uFEFF" +
        [
            keys.map((k) => quote(FIELDS[k])).join(","),
            ...rows.map((r) => {
                const escaped = keys.filter((k) => needsEscape(r[k] ?? ""));
                return keys
                    .map((k) => quote(k === "escaped"
                    ? escaped.join(";")
                    : (escaped.includes(k) ? "'" : "") + (r[k] ?? "")))
                    .join(",");
            }),
        ].join("\r\n"));
}
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]));
    return value;
}
function fingerprint(entry) {
    const { id: _id, createdAt: _createdAt, ...data } = entry;
    return JSON.stringify(canonical(data));
}
export function previewCSV(rows, mapping, current) {
    const book = structuredClone(current);
    let added = 0, duplicates = 0;
    const errors = [], preview = [];
    const idx = Object.fromEntries(Object.entries(mapping)
        .filter(([, v]) => v)
        .map(([k, v]) => [k, rows[0].indexOf(v)]));
    const existing = new Map(book.entries.map((e) => [e.id, e]));
    const fingerprints = new Set(book.entries.map(fingerprint));
    for (let i = 1; i < rows.length; i++) {
        const get = (key, fallback = "") => {
            const col = idx[key];
            let value = col === undefined || col < 0 ? "" : rows[i][col].trim();
            const escapes = idx.escaped === undefined ? [] : rows[i][idx.escaped].split(";");
            if (key !== "escaped" && escapes.includes(key) && value.startsWith("'"))
                value = value.slice(1);
            return value || fallback;
        };
        const kindInput = get("kind", "投资");
        const kind = Object.entries(kindNames).find(([key, name]) => key === kindInput || name === kindInput)?.[0];
        const status = {
            line: i + 1,
            name: get("project", get("reason", get("note"))),
            kind: kindInput,
            date: get("date"),
            amount: "",
            status: "待导入",
        };
        try {
            if (!kind)
                throw new Error("类型须为投资、出入金、兑换、期初、调整或项目");
            let project;
            if (kind === "investment" || kind === "project") {
                const pid = get("projectId"), name = get("project");
                project = book.projects.find((p) => pid ? p.id === pid : p.name === name);
                if (!pid && book.projects.filter((p) => p.name === name).length > 1)
                    throw new Error("同名项目不唯一，请映射项目ID");
                if (!project) {
                    if (!name)
                        throw new Error("缺少项目名称");
                    project = {
                        id: pid || id(),
                        name,
                        category: get("category", "其他"),
                        account: get("account"),
                        related: get("related") || null,
                        notes: get("projectNotes"),
                        createdAt: get("createdAt", new Date().toISOString()),
                    };
                    book.projects.push(project);
                }
                else if (name && project.name !== name)
                    throw new Error("项目ID与项目名称冲突");
            }
            if (kind === "project") {
                status.status = "项目资料";
                preview.push(status);
                continue;
            }
            const makeMoney = (prefix, history = false) => {
                const q = get((prefix + "Qty"));
                if (!q)
                    return null;
                const a = get((prefix + "Asset"), "USD");
                return {
                    asset: a,
                    qty: norm(q),
                    price: history
                        ? a === "USD"
                            ? "1"
                            : get((prefix + "Price")) || null
                        : null,
                };
            };
            const common = {
                ...base(get("date")),
                id: get("id") || id(),
                createdAt: get("createdAt", new Date().toISOString()),
                account: get("account"),
                note: get("note"),
                deleted: get("deleted") === "true",
            };
            let entry;
            if (kind === "investment") {
                const rawRelease = get("release");
                const release = rawRelease
                    ? rawRelease.split(/[;；]/).map((v) => {
                        const [a, q, ...extra] = v.split(/[:：]/);
                        if (!a || !q || extra.length)
                            throw new Error("本次结转成本格式为 USD:500;ETH:0.1");
                        return { asset: a.trim(), qty: norm(q) };
                    })
                    : [];
                const vasset = get("valuationAsset");
                const vqty = get("valuationQty");
                entry = {
                    ...blankInvestment(project.id),
                    ...common,
                    cost: makeMoney("cost", true),
                    recovery: makeMoney("recovery", true),
                    fee: makeMoney("fee", true),
                    feeTreatment: get("feeTreatment", get("costQty") ? "cost" : "settlement"),
                    reserve: makeMoney("reserve"),
                    valuation: vasset || vqty
                        ? {
                            asset: (vasset || "USD"),
                            qty: vqty === "" || vqty === "未知" ? null : norm(vqty),
                        }
                        : null,
                    release,
                    projectState: (get("state") || null),
                };
                // Canonical shape avoids phantom duplicates caused by extra null price properties.
                if (entry.reserve)
                    entry.reserve = {
                        asset: entry.reserve.asset,
                        qty: entry.reserve.qty,
                    };
            }
            else if (kind === "cash") {
                if (!get("direction") || !get("fiat"))
                    throw new Error("出入金必须明确映射方向和法币类型，不能猜测入金或 CNY / HKD");
                if (get("feeAsset", "USD") !== "USD")
                    throw new Error("出入金手续费必须先折算为 USD，请核对手续费币种");
                const usd = norm(get("usdAmount"));
                const fiat = norm(get("fiatAmount"));
                entry = {
                    ...common,
                    kind: "cash",
                    direction: { 入金: "in", 出金: "out" }[get("direction")] || get("direction", "in"),
                    fiat: get("fiat", "CNY"),
                    fiatAmount: fiat,
                    usdAmount: usd,
                    rate: str(div(dec(fiat), dec(usd))),
                    fee: norm(get("feeQty", "0")),
                    payment: get("payment", "USD"),
                    paymentAmount: norm(get("paymentAmount", usd)),
                };
            }
            else if (kind === "exchange") {
                const simple = (p) => {
                    const m = makeMoney(p);
                    return m ? { asset: m.asset, qty: m.qty } : null;
                };
                entry = {
                    ...common,
                    kind: "exchange",
                    from: simple("from"),
                    to: simple("to"),
                    fee: simple("fee"),
                };
            }
            else
                entry = {
                    ...common,
                    kind: kind,
                    asset: get("asset", "USD"),
                    qty: norm(get("qty")),
                    reason: get("reason"),
                };
            status.amount =
                entry.kind === "cash"
                    ? `${entry.fiatAmount} ${entry.fiat} / ${entryAmount(entry)}`
                    : entryAmount(entry);
            const old = existing.get(entry.id), fp = fingerprint(entry);
            if (old && fingerprint(old) !== fp)
                throw new Error("流水ID已存在但内容不同，请在应用中编辑原记录");
            // Explicit IDs identify distinct transactions, even when all amounts match.
            // Only rows without a supplied ID fall back to matching their contents.
            if (old || (!get("id") && fingerprints.has(fp))) {
                duplicates++;
                status.status = "重复，跳过";
            }
            else {
                book.entries.push(entry);
                existing.set(entry.id, entry);
                fingerprints.add(fp);
                added++;
            }
        }
        catch (e) {
            status.status = "错误";
            errors.push(`第 ${i + 1} 行：${e instanceof Error ? e.message : String(e)}`);
        }
        preview.push(status);
    }
    try {
        assertBook(book);
    }
    catch (e) {
        errors.push(`账务校验：${e instanceof Error ? e.message : String(e)}`);
    }
    return { book, added, duplicates, errors, preview };
}
export function csvTemplate() {
    return "\uFEFF类型,日期,项目名称,分类,成本币种,成本数量,成本历史USD单价,估值币种,剩余估值,账户,备注\r\n投资,2026-01-01,示例项目,生态投资,USD,400,1,USD,450,主账户,虚构示例；导入前删除此行";
}
export const assetFields = ASSETS;
