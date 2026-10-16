export const ASSETS = ["BTC", "ETH", "BNB", "SOL", "USD"];
export function id() {
    return crypto.randomUUID();
}
export const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const base = (date = today()) => ({
    id: id(),
    date,
    createdAt: new Date().toISOString(),
    account: "",
    note: "",
    deleted: false,
});
export function emptyBook() {
    return {
        schema: 1,
        id: id(),
        name: "我的投资账本",
        revision: 0,
        projects: [],
        entries: [],
        prices: Object.fromEntries(ASSETS.map((a) => [
            a,
            {
                value: a === "USD" ? "1" : null,
                at: null,
                source: a === "USD" ? "manual" : "missing",
                error: null,
            },
        ])),
        settings: { interval: 5, auto: true },
        audit: [],
    };
}
export function blankInvestment(projectId = "", date = today()) {
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
