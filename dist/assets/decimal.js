/** Fixed-point base 10, 18 places. Amounts are JSON strings; no binary floats in accounting. */
export const SCALE = 10n ** 18n;
export const MAX = 10n ** 33n; // 10^15 units, checked at input boundaries
export function dec(value) {
    const s = String(value).trim();
    if (!/^-?\d+(\.\d{1,18})?$/.test(s))
        throw new Error("请输入普通十进制数字，最多 18 位小数");
    const negative = s.startsWith("-");
    const [whole, fraction = ""] = s.replace("-", "").split(".");
    const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
    if (result > MAX)
        throw new Error("单笔数量须不超过 1,000,000,000,000,000");
    return negative ? -result : result;
}
export function str(value) {
    const negative = value < 0n;
    const n = negative ? -value : value;
    const fraction = (n % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
    return `${negative ? "-" : ""}${n / SCALE}${fraction ? "." + fraction : ""}`;
}
export const mul = (a, b) => (a * b) / SCALE;
export const div = (a, b) => {
    if (b === 0n)
        throw new Error("除数不能为零");
    return (a * SCALE) / b;
};
export const norm = (s) => str(dec(s));
export const nullableSum = (items) => items.some((x) => x === null)
    ? null
    : items.reduce((a, b) => a + (b ?? 0n), 0n);
export const amountUSD = (qty, price) => dec(qty) === 0n ? 0n : price === null ? null : mul(dec(qty), dec(price));
