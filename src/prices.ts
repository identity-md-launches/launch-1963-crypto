import { type Book, type Asset, type Price } from "./model.js";
import { dec, norm } from "./decimal.js";
export const PRICE_ENDPOINT =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin%2Cethereum%2Cbinancecoin%2Csolana&vs_currencies=usd&include_last_updated_at=true";
const IDS: Record<Exclude<Asset, "USD">, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
};
export function mergeMarketPrices(
  old: Book["prices"],
  payload: unknown,
  now = Date.now(),
): Book["prices"] {
  const next = structuredClone(old);
  const data = payload as Record<
    string,
    { usd?: unknown; last_updated_at?: unknown }
  >;
  for (const [asset, key] of Object.entries(IDS) as [
    Exclude<Asset, "USD">,
    string,
  ][]) {
    const item = data?.[key];
    try {
      if (
        typeof item?.usd !== "number" ||
        !Number.isFinite(item.usd) ||
        item.usd <= 0 ||
        typeof item.last_updated_at !== "number" ||
        !Number.isFinite(item.last_updated_at)
      )
        throw new Error();
      const value = norm(item.usd.toFixed(12));
      if (
        dec(value) <= 0n ||
        item.last_updated_at * 1000 > now + 300000 ||
        item.last_updated_at * 1000 < now - 30 * 60 * 1000
      )
        throw new Error();
      next[asset] = {
        value,
        at: new Date(item.last_updated_at * 1000).toISOString(),
        source: "market",
        error: null,
      };
    } catch {
      next[asset].error = "返回的价格或时间无效，已保留上次价格";
    }
  }
  next.USD = { value: "1", at: null, source: "manual", error: null };
  return next;
}
export async function refreshPrices(
  old: Book["prices"],
  fetcher: typeof fetch = fetch,
): Promise<Book["prices"]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher(PRICE_ENDPOINT, {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return mergeMarketPrices(old, await response.json());
  } catch (e) {
    const next = structuredClone(old);
    const detail =
      e instanceof Error && e.message.startsWith("HTTP")
        ? e.message
        : "网络、限流或跨域限制";
    for (const a of Object.keys(IDS) as Exclude<Asset, "USD">[])
      next[a].error = `更新失败（${detail}），已保留上次价格`;
    return next;
  } finally {
    clearTimeout(timer);
  }
}
export function priceStatus(
  p: Price,
  interval: number,
  now = Date.now(),
): string {
  if (!p.value) return "未设置";
  if (p.error) return "更新失败";
  if (p.source === "demo") return "演示价格";
  if (p.source === "manual") return "手动备用";
  if (!p.at || now - Date.parse(p.at) > Math.max(interval * 2, 5) * 60000)
    return "价格过期";
  return "已更新";
}
