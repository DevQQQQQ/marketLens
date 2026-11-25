// src/services/safeTradeService.ts
import type { MarketItem } from "../types";
import { cryptoGet, DEFAULT_PROXY_URL, type CryptoNetworkOptions } from "./network.ts";
import { logger, describeForLog } from "../utils/logger.ts";

export interface SafeTradeTickerResponse {
  at?: number;
  ticker?: {
    buy?: string;
    sell?: string;
    low?: string;
    high?: string;
    last?: string;
    vol?: string;
    price_change_percent?: string;
  };
}

export class SafeTradeService {
  // 记录已被确认失效（返回 400/404 或下架）的 symbol，避免每轮轮询反复请求
  private invalidSymbols = new Map<string, number>();
  private readonly INVALID_CACHE_TTL = 10 * 60 * 1000; // 10分钟后允许重新探测一次

  // 记录单币连续失败次数
  private symbolFailureCounts = new Map<string, number>();
  private readonly MAX_CONSECUTIVE_FAILURES = 3;

  public clearInvalidCache(): void {
    this.invalidSymbols.clear();
    this.symbolFailureCounts.clear();
  }

  /** 修剪已不在当前自选中的标的的抑制与失败计数，防止 Map 随历史标的无界增长 */
  public pruneInactiveSymbols(activeSymbols: readonly string[]): void {
    const active = new Set(activeSymbols.map((s) => this.normalizeSymbol(s)));
    for (const key of this.invalidSymbols.keys()) {
      if (!active.has(key)) this.invalidSymbols.delete(key);
    }
    for (const key of this.symbolFailureCounts.keys()) {
      if (!active.has(key)) this.symbolFailureCounts.delete(key);
    }
  }

  public isSymbolSuppressed(s: string): boolean {
    return this.isSymbolInvalid(this.normalizeSymbol(s));
  }

  public normalizeSymbol(raw: string): string {
    const stripped = raw.trim().replace(/^safetrade:/i, "").trim();
    return stripped.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  public formatDisplayName(market: string): string {
    const quotes = ["usdt", "usdc", "btc", "eth"];
    for (const q of quotes) {
      if (market.endsWith(q) && market.length > q.length) {
        const base = market.slice(0, -q.length).toUpperCase();
        return `${base}/${q.toUpperCase()}`;
      }
    }
    return market.toUpperCase();
  }

  public parseTicker(rawSymbol: string, market: string, data: SafeTradeTickerResponse): MarketItem | null {
    if (!data || !data.ticker) return null;
    const t = data.ticker;
    const lastPrice = parseFloat(t.last ?? "");
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;

    const rawHigh = parseFloat(t.high ?? "");
    const rawLow = parseFloat(t.low ?? "");
    const rawVol = parseFloat(t.vol ?? "");
    const high = Number.isFinite(rawHigh) ? rawHigh : undefined;
    const low = Number.isFinite(rawLow) ? rawLow : undefined;
    const volume = Number.isFinite(rawVol) ? rawVol : undefined;

    let changePercent = 0;
    if (t.price_change_percent) {
      const cleanPercent = t.price_change_percent.replace("%", "").trim();
      const parsedPct = parseFloat(cleanPercent);
      changePercent = Number.isFinite(parsedPct) ? parsedPct : 0;
    }

    // 涨跌额推算：若存在有效涨跌幅且昨收不为0
    let change = 0;
    if (lastPrice > 0 && changePercent !== 0) {
      const prevPrice = lastPrice / (1 + changePercent / 100);
      if (Number.isFinite(prevPrice) && prevPrice > 0) {
        change = lastPrice - prevPrice;
      }
    }

    const name = this.formatDisplayName(market);
    const updateTime = data.at ? data.at * 1000 : Date.now();

    const upper = market.toUpperCase();
    let currency: MarketItem["currency"] = "USDT";
    if (upper.endsWith("BTC")) currency = "BTC";
    else if (upper.endsWith("ETH")) currency = "ETH";

    const standardSymbol = rawSymbol.toLowerCase().startsWith("safetrade:")
      ? `safetrade:${market}`
      : rawSymbol;

    return {
      id: standardSymbol,
      name,
      symbol: standardSymbol,
      type: "CRYPTO",
      price: lastPrice,
      changePercent,
      change,
      high,
      low,
      volume,
      currency,
      updateTime,
      dataSource: "SafeTrade",
    };
  }

  public async fetchSingleQuote(
    symbol: string,
    options: CryptoNetworkOptions
  ): Promise<MarketItem | null> {
    const market = this.normalizeSymbol(symbol);
    if (!market) return null;

    if (this.isSymbolInvalid(market)) {
      return null;
    }

    const url = `https://safetrade.com/api/v2/trade/public/tickers/${market}`;
    try {
      const resp = await cryptoGet<SafeTradeTickerResponse>(url, options, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });

      this.symbolFailureCounts.delete(market);
      return this.parseTicker(symbol, market, resp.data);
    } catch (err: unknown) {
      const errObj = err as { response?: { status?: number }; message?: string } | null;
      const status = errObj?.response?.status;
      if (status === 404 || status === 400) {
        this.markSymbolInvalid(market);
      } else {
        const count = (this.symbolFailureCounts.get(market) || 0) + 1;
        this.symbolFailureCounts.set(market, count);
        if (count >= this.MAX_CONSECUTIVE_FAILURES) {
          this.markSymbolInvalid(market);
        }
      }
      logger.debug(`[SafeTradeService] 获取 ${describeForLog(symbol)} 失败:`, errObj?.message || err);
      return null;
    }
  }

  public async fetchQuotes(
    symbols: string[],
    options: CryptoNetworkOptions = { mode: "proxy", proxyUrl: DEFAULT_PROXY_URL }
  ): Promise<MarketItem[]> {
    if (!symbols.length) return [];
    const cleanSymbols = [...new Set(symbols.filter(Boolean))];
    const results = await Promise.allSettled(
      cleanSymbols.map((sym) => this.fetchSingleQuote(sym, options))
    );
    const quotes: MarketItem[] = [];
    for (const res of results) {
      if (res.status === "fulfilled" && res.value) {
        quotes.push(res.value);
      }
    }
    return quotes;
  }

  private isSymbolInvalid(s: string): boolean {
    const expireAt = this.invalidSymbols.get(s);
    if (!expireAt) return false;
    if (Date.now() > expireAt) {
      this.invalidSymbols.delete(s);
      return false;
    }
    return true;
  }

  private markSymbolInvalid(s: string): void {
    this.invalidSymbols.set(s, Date.now() + this.INVALID_CACHE_TTL);
    // 同步清零失败计数：否则 TTL 过期恢复后残留计数使单次失败立即再抑制，「连续 N 轮」契约失效
    this.symbolFailureCounts.delete(s);
    logger.warn(`[SafeTradeService] 标的 ${describeForLog(s)} 不可用或已下架，已加入临时抑制黑名单(10分钟)`);
  }
}
