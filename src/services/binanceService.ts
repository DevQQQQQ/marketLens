// src/services/binanceService.ts
import type { MarketItem } from "../types";
import { cryptoGet, DEFAULT_PROXY_URL, type CryptoNetworkOptions } from "./network.ts";
import { logger } from "../utils/logger.ts";
import { chunkArray } from "../utils/symbolHelper.ts";

export interface BinanceTicker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  prevClosePrice: string;
  volume: string;
  quoteVolume: string;
}

export class BinanceService {
  // 记录已被确认失效（返回 400 或下架）的 symbol，避免每轮轮询都导致批量接口 400 并引发降级风暴
  private invalidSymbols = new Map<string, number>();
  private readonly INVALID_CACHE_TTL = 10 * 60 * 1000; // 10分钟后允许重新探测一次

  // 记录单币降级时的连续失败次数，防止坏币因超时/网络故障未返回 400 导致每轮反复重演 N 次单查
  private symbolFailureCounts = new Map<string, number>();
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly CHUNK_SIZE = 50;

  public clearInvalidCache(): void {
    this.invalidSymbols.clear();
    this.symbolFailureCounts.clear();
  }

  public isSymbolSuppressed(s: string): boolean {
    return this.isSymbolInvalid(s);
  }

  public markSymbolInvalidForTest(s: string): void {
    this.markSymbolInvalid(s);
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
    logger.warn(`[BinanceService] 标的 "${s}" 在币安不可用或已下架，已加入临时抑制黑名单(10分钟)`);
  }

  public normalizeSymbol(raw: string): string {
    return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  }

  public formatDisplayName(symbol: string): string {
    const quotes = ["USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH"];
    for (const q of quotes) {
      if (symbol.endsWith(q) && symbol.length > q.length) {
        return `${symbol.slice(0, -q.length)}/${q}`;
      }
    }
    return symbol;
  }

  public parseTickerItem(item: BinanceTicker24hr): MarketItem {
    const sym = item.symbol;
    return {
      id:           sym,
      name:         this.formatDisplayName(sym),
      symbol:       sym,
      type:         "CRYPTO",
      price:        parseFloat(item.lastPrice)         || 0,
      changePercent: parseFloat(item.priceChangePercent) || 0,
      open:         parseFloat(item.openPrice)         || 0,
      prevClose:    parseFloat(item.prevClosePrice)    || 0,
      high:         parseFloat(item.highPrice)         || 0,
      low:          parseFloat(item.lowPrice)          || 0,
      change:       parseFloat(item.priceChange)       || 0,
      volume:       parseFloat(item.volume)            || 0,
      turnover:     parseFloat(item.quoteVolume)       || 0,
      currency:     "USD",
    };
  }

  /**
   * 批量拉取 Binance 行情（支持大批量分批切片保护，彻底规避 100 标的上限）
   * @param symbols 币对列表
   * @param options 网络代理配置（强制代理/直连、指定代理URL）
   */
  async fetchQuotes(
    symbols: string[],
    options: CryptoNetworkOptions = { mode: "proxy", proxyUrl: DEFAULT_PROXY_URL }
  ): Promise<MarketItem[]> {
    if (!symbols.length) { return []; }

    const cleanSymbols = [...new Set(symbols.map((s) => this.normalizeSymbol(s)).filter(Boolean))];
    if (!cleanSymbols.length) { return []; }

    // 过滤掉当前仍在抑制期内的失效币种，保证批量接口可以一次性成功
    const activeSymbols = cleanSymbols.filter((s) => !this.isSymbolInvalid(s));
    if (!activeSymbols.length) { return []; }

    const chunks = chunkArray(activeSymbols, this.CHUNK_SIZE);
    const chunkPromises = chunks.map((batch) => this.fetchBatch(batch, options));
    const results = await Promise.all(chunkPromises);
    return results.flat();
  }

  private async fetchBatch(
    activeSymbols: string[],
    options: CryptoNetworkOptions
  ): Promise<MarketItem[]> {
    if (!activeSymbols.length) { return []; }

    const symbolsParam = encodeURIComponent(JSON.stringify(activeSymbols));
    const endpoints = [
      `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${symbolsParam}`,
      `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`,
    ];

    let is400Error = false;
    for (const url of endpoints) {
      try {
        const response = await cryptoGet<BinanceTicker24hr[] | BinanceTicker24hr>(
          url,
          options,
          { timeout: 5000 }
        );

        const rawList = Array.isArray(response.data) ? response.data : [response.data];
        this.symbolFailureCounts.clear();

        return rawList.map((item) => this.parseTickerItem(item));
      } catch (err: any) {
        if (err?.response?.status === 400 || err?.status === 400 || String(err?.message || "").includes("400")) {
          is400Error = true;
        }
      }
    }

    // 仅在批量接口明确返回 400（确认某个币对非法/已下架，导致整个批量接口报错）时，才降级为单币并发以挽救其余正常币
    // 若属于网络连接失败、超时或代理未通等网络级故障，直接返回，绝不放大并发重放 N 次单币请求
    if (!is400Error) {
      logger.error("[BinanceService] All endpoints failed (network or proxy error) for: " + activeSymbols.join(", "));
      return [];
    }

    // 兜底策略：如果批量查询因某个退市/无效币种导致 400 失败，转为单币并发查询，保障正常币种正常展示并识别出失效币种
    const successfulItems: MarketItem[] = [];
    await Promise.allSettled(
      activeSymbols.map(async (s) => {
        const singleUrl = `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${encodeURIComponent(s)}`;
        try {
          const res = await cryptoGet<BinanceTicker24hr>(singleUrl, options, { timeout: 3500 });
          const item = res.data;
          const sym = item.symbol;
          this.symbolFailureCounts.delete(sym);
          this.symbolFailureCounts.delete(s);
          successfulItems.push(this.parseTickerItem(item));
        } catch (err: any) {
          const is400 = err?.response?.status === 400 || err?.status === 400 || String(err?.message || "").includes("400");
          const failCount = (this.symbolFailureCounts.get(s) || 0) + 1;
          this.symbolFailureCounts.set(s, failCount);

          // 若单币查询明确返回 400（即 Invalid symbol），或连续非 400 失败达到阈值（如连续 3 次超时），
          // 将其标为失效抑制，防止下轮继续拖垮批量接口引发单查重演风暴
          if (is400 || failCount >= this.MAX_CONSECUTIVE_FAILURES) {
            this.markSymbolInvalid(s);
            this.symbolFailureCounts.delete(s);
          }
        }
      })
    );

    if (successfulItems.length > 0) {
      return successfulItems;
    }

    logger.error("[BinanceService] All endpoints and individual fallbacks failed for: " + activeSymbols.join(", "));
    return [];
  }
}