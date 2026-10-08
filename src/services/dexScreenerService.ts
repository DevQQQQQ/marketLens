// src/services/dexScreenerService.ts
import type { MarketItem } from "../types";
import { cryptoGet, DEFAULT_PROXY_URL, type CryptoNetworkOptions } from "./network.ts";
import { logger } from "../utils/logger.ts";

interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number; m5?: number };
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexPair[] | null;
}

function isValidContractAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

function formatChainName(chainId: string | undefined): string {
  if (!chainId) return "DEX";
  const lower = chainId.toLowerCase();
  switch (lower) {
    case "bsc": return "BSC";
    case "solana": return "Solana";
    case "base": return "Base";
    case "ethereum": return "Ethereum";
    case "arbitrum": return "Arbitrum";
    case "polygon": return "Polygon";
    case "avalanche": return "Avalanche";
    case "sui": return "Sui";
    case "ton": return "TON";
    default: return chainId.toUpperCase();
  }
}

function formatDexName(dexId: string | undefined): string {
  if (!dexId) return "DEX";
  const lower = dexId.toLowerCase();
  switch (lower) {
    case "pancakeswap": return "PancakeSwap";
    case "raydium": return "Raydium";
    case "uniswap": return "Uniswap";
    case "pumpfun": return "Pump.fun";
    case "meteora": return "Meteora";
    case "aerodrome": return "Aerodrome";
    default: return dexId.charAt(0).toUpperCase() + dexId.slice(1);
  }
}

function pickBestPair(pairs: DexPair[]): DexPair | null {
  if (!pairs?.length) { return null; }
  return pairs.reduce((best, cur) =>
    (cur.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? cur : best
  , pairs[0]);
}

export class DexScreenerService {
  // 记录已被确认失效（无流动性池/已下架/不存在）的合约地址，避免每轮轮询重复发起批量与单查重试风暴
  private invalidAddresses = new Map<string, number>();
  private readonly INVALID_CACHE_TTL = 10 * 60 * 1000; // 10分钟后允许重新探测一次

  // 记录连续未检索到流动性池的失败次数，防止偶发网络抖动误判
  private addressFailureCounts = new Map<string, number>();
  private readonly MAX_CONSECUTIVE_FAILURES = 2; // 连续 2 轮确认无池子即加入抑制

  public clearInvalidCache(): void {
    this.invalidAddresses.clear();
    this.addressFailureCounts.clear();
  }

  public isAddressSuppressed(addr: string): boolean {
    return this.isAddressInvalid(addr);
  }

  private isAddressInvalid(addr: string): boolean {
    const key = addr.toLowerCase();
    const expireAt = this.invalidAddresses.get(key);
    if (!expireAt) return false;
    if (Date.now() > expireAt) {
      this.invalidAddresses.delete(key);
      return false;
    }
    return true;
  }

  private markAddressInvalid(addr: string): void {
    const key = addr.toLowerCase();
    this.invalidAddresses.set(key, Date.now() + this.INVALID_CACHE_TTL);
    logger.warn(
      `[DexScreenerService] 合约地址 "${addr}" 未检索到流动性池或已下架，已加入临时抑制黑名单(10分钟)`
    );
  }

  /**
   * 全链 Alpha 抓取（支持代理模式与直连模式配置）
   */
  async fetchQuotes(
    contractAddresses: string[],
    options: CryptoNetworkOptions = { mode: "proxy", proxyUrl: DEFAULT_PROXY_URL }
  ): Promise<MarketItem[]> {
    if (!contractAddresses?.length) { return []; }

    const validAddresses = [...new Set(
      contractAddresses
        .map((a) => a.trim())
        .filter((a) => {
          if (!isValidContractAddress(a)) {
            logger.warn(
              `[DexScreenerService] 跳过无效地址 "${a}"` +
              " — Alpha 代币请使用 EVM (0x...) 或 Solana Mint 合约地址。"
            );
            return false;
          }
          return true;
        })
    )];

    if (!validAddresses.length) { return []; }

    // 过滤掉当前正处于 10 分钟临时抑制期内的失效合约地址，彻底消除降级风暴与重复单查
    const activeAddresses = validAddresses.filter((a) => !this.isAddressInvalid(a));
    if (!activeAddresses.length) { return []; }

    // DexScreener API 单次响应硬限制最多返回 30 个流动性池（pairs）。
    // 若代币较为热门，单个代币常包含 4~5 个交易池，若每批包含较多代币，总池数超过 30 就会导致排在后面的代币被服务端截断挤掉（如 quq）。
    // 因此将分批切片大小限制为安全的 5 个地址/批，既保证极低的 HTTP 开销，又彻底杜绝代币被截断丢失。
    const CHUNK_SIZE = 5;
    const chunks: string[][] = [];
    for (let i = 0; i < activeAddresses.length; i += CHUNK_SIZE) {
      chunks.push(activeAddresses.slice(i, i + CHUNK_SIZE));
    }

    const chunkResults = await Promise.allSettled(
      chunks.map((chunk) => this.fetchBatch(chunk, options))
    );

    const items: MarketItem[] = [];
    const acquiredAddresses = new Set<string>();
    // 记录因网络/代理错误彻底失败的批次地址——这些是真正的网络故障，不做补查
    const networkFailedAddresses = new Set<string>();

    for (let i = 0; i < chunkResults.length; i++) {
      const r = chunkResults[i];
      if (r.status === "fulfilled") {
        if (r.value.networkError) {
          // 批次因网络错误失败，将这批地址标记，补查无意义（只会再次超时）
          for (const addr of chunks[i]) {
            networkFailedAddresses.add(addr.toLowerCase());
          }
        } else {
          for (const item of r.value.items) {
            items.push(item);
            if (item.id) {
              const lowId = item.id.toLowerCase();
              acquiredAddresses.add(lowId);
              this.addressFailureCounts.delete(lowId);
            }
          }
        }
      }
    }

    // 自动漏网探测（Self-Healing）：仅对 HTTP 成功但因池子过多被截断的地址补查
    // 网络/代理故障的地址直接跳过，防止代理断开时 N 次单查重演
    const missingAddresses = activeAddresses.filter((a) => {
      const lower = a.toLowerCase();
      return !acquiredAddresses.has(lower) && !networkFailedAddresses.has(lower);
    });
    if (missingAddresses.length > 0) {
      const fallbackResults = await Promise.allSettled(
        missingAddresses.map((addr) => this.fetchBatch([addr], options))
      );
      for (let i = 0; i < fallbackResults.length; i++) {
        const fr = fallbackResults[i];
        const targetAddr = missingAddresses[i];
        const lower = targetAddr.toLowerCase();
        if (fr.status === "fulfilled" && !fr.value.networkError) {
          if (fr.value.items.length > 0) {
            items.push(...fr.value.items);
            this.addressFailureCounts.delete(lower);
          } else {
            // 明确返回 HTTP 成功但依然无交易对（已归零/撤池/无效地址）
            const count = (this.addressFailureCounts.get(lower) || 0) + 1;
            this.addressFailureCounts.set(lower, count);
            if (count >= this.MAX_CONSECUTIVE_FAILURES) {
              this.markAddressInvalid(targetAddr);
            }
          }
        }
      }
    }

    return items;
  }

  private async fetchBatch(
    addresses: string[],
    options: CryptoNetworkOptions
  ): Promise<{ items: MarketItem[]; networkError: boolean }> {
    if (addresses.length === 0) return { items: [], networkError: false };
    const joined = addresses.join(",");
    const url = `https://api.dexscreener.com/latest/dex/tokens/${joined}`;
    try {
      const response = await cryptoGet<DexScreenerResponse>(url, options, { timeout: 6000 });
      const pairs = response.data?.pairs || [];
      if (!pairs.length) return { items: [], networkError: false };

      // 按 baseToken address 将 pairs 分组
      const pairsByToken = new Map<string, DexPair[]>();
      for (const p of pairs) {
        const addr = p.baseToken?.address;
        if (!addr) continue;
        const lowAddr = addr.toLowerCase();
        if (!pairsByToken.has(lowAddr)) {
          pairsByToken.set(lowAddr, []);
        }
        pairsByToken.get(lowAddr)!.push(p);
      }

      const items: MarketItem[] = [];
      for (const targetAddr of addresses) {
        const tokenPairs = pairsByToken.get(targetAddr.toLowerCase()) || [];
        if (!tokenPairs.length) continue;

        const best = pickBestPair(tokenPairs);
        if (!best) continue;

        const priceUsd = parseFloat(best.priceUsd) || 0;
        const changeH24 = best.priceChange?.h24 ?? 0;

        let estimatedOpen: number | undefined = undefined;
        if (priceUsd > 0 && changeH24 !== -100) {
          estimatedOpen = priceUsd / (1 + changeH24 / 100);
        }

        items.push({
          id:            targetAddr,
          name:          best.baseToken?.name   || best.baseToken?.symbol || "Unknown",
          symbol:        best.baseToken?.symbol || "TOKEN",
          type:          "ALPHA_TOKEN",
          price:         priceUsd,
          changePercent: changeH24,
          open:          estimatedOpen,
          prevClose:     estimatedOpen,
          turnover:      best.volume?.h24 ?? 0,
          liquidity:     best.liquidity?.usd ?? 0,
          chain:         formatChainName(best.chainId),
          dex:           formatDexName(best.dexId),
          currency:      "USD",
        });
      }
      return { items, networkError: false };
    } catch (err: any) {
      // 有 err.response 说明是 HTTP 业务错误（如 404 合约不存在），不算网络故障
      const isNetworkError = !err?.response;
      logger.error(`[DexScreenerService] 批量拉取代币行情失败: ${err?.message || err}`, err);
      return { items: [], networkError: isNetworkError };
    }
  }
}