// src/services/symbolSearchService.ts
import { smartNetworkGet } from "./network.ts";
import { readConfig } from "../utils/config.ts";
import { decodeGbk, isContractAddress } from "../utils/symbolHelper.ts";
import { logger } from "../utils/logger.ts";

/** 搜索命中结果条目 */
export interface SearchResultItem {
  symbol: string;        // 规范化后的标的代码 (如 sh600519, sz000001, hk00700, AAPL)
  name: string;          // 标的名称 (如 贵州茅台, 平安银行, 腾讯控股, Apple)
  type: "A_SHARE" | "HK_STOCK" | "US_STOCK" | "CRYPTO" | "ALPHA_TOKEN"; // 资产类型
  pinyin?: string | undefined; // 拼音缩写 (如 gzmt, payh, txkg)
  defaultGroup: string;  // 默认分组建议 (A股, 港股, 美股, 基金)
  hint: string;          // 提示描述
}

/** 腾讯 Smartbox 联想搜索接口地址 */
export const TENCENT_SMARTBOX_URL = "https://smartbox.gtimg.cn/s3/";

/** 内存短期搜索缓存 (TTL: 60 秒) */
interface CacheEntry {
  timestamp: number;
  items: SearchResultItem[];
}
const SEARCH_CACHE_TTL_MS = 60 * 1000;
const MAX_SEARCH_CACHE_SIZE = 200;
const _searchCache = new Map<string, CacheEntry>();

/** 重置搜索缓存（供测试使用） */
export function resetSearchCacheForTesting(): void {
  _searchCache.clear();
}

/** 解码腾讯接口返回的 Unicode 转义字符 (如 \u8d35\u5dde -> 贵州) */
export function decodeUnicodeEscapes(input: string): string {
  if (!input.includes("\\u")) {
    return input;
  }
  return input.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return `\\u${hex}`;
    }
  });
}

/**
 * 解析腾讯 Smartbox 原始响应文本
 * 原始报文格式示例：
 * v_hint="sh~600519~\u8d35\u5dde\u8305\u53f0~gzmt~GP-A^hk~00700~\u817e\u8baf\u63a7\u80a1~txkg~GP^us~aapl.oq~Apple~apple~GP";
 * 或无匹配时：
 * v_hint="N";
 */
export function parseSmartboxResponse(rawText: string): SearchResultItem[] {
  if (!rawText || typeof rawText !== "string") {
    return [];
  }

  // 提取引号内部有效文本
  const match = rawText.match(/v_hint="([^"]*)"/);
  const payload = match ? match[1] : rawText.trim();
  if (!payload || payload === "N") {
    return [];
  }

  // 解码可能存在的 Unicode 转义
  const decodedPayload = decodeUnicodeEscapes(payload);

  const rawEntries = decodedPayload.split("^");
  const results: SearchResultItem[] = [];

  for (const entry of rawEntries) {
    if (!entry) continue;
    const parts = entry.split("~");
    if (parts.length < 3) continue;

    const market = parts[0]?.trim().toLowerCase() || "";
    const rawCode = parts[1]?.trim() || "";
    const name = parts[2]?.trim() || "";
    const pinyin = parts[3]?.trim() || "";
    const rawType = (parts[4]?.trim() || "").toUpperCase();

    if (!market || !rawCode || !name) continue;

    // 过滤权证/牛熊证/涡轮 (QZ)，降低散户误选风险
    if (rawType === "QZ") {
      continue;
    }

    // 1. A 股市场 (沪/深/北)
    if (market === "sh" || market === "sz" || market === "bj") {
      const fullSymbol = `${market}${rawCode}`;
      // 场内基金/ETF 智能识别
      const isFund = /^(5[0168]\d{4}|1[56]\d{4})$/.test(rawCode) || rawType === "ETF" || rawType === "LOF";
      results.push({
        symbol: fullSymbol,
        name,
        type: "A_SHARE",
        pinyin: pinyin !== "*" ? pinyin : undefined,
        defaultGroup: isFund ? "基金" : "A股",
        hint: isFund ? `场内基金/ETF (${fullSymbol})` : `A股 (${fullSymbol})`,
      });
      continue;
    }

    // 2. 港股市场
    if (market === "hk") {
      const formattedCode = rawCode.padStart(5, "0");
      const fullSymbol = `hk${formattedCode}`;
      results.push({
        symbol: fullSymbol,
        name,
        type: "HK_STOCK",
        pinyin: pinyin !== "*" ? pinyin : undefined,
        defaultGroup: "港股",
        hint: `港股 (${fullSymbol})`,
      });
      continue;
    }

    // 3. 美股市场
    if (market === "us") {
      // 剔除交易所后缀 (如 .oq, .n, .am, .ps)
      const ticker = rawCode.replace(/\.(?:oq|n|am|ps|otc)$/i, "").toUpperCase();
      if (!ticker) continue;
      results.push({
        symbol: ticker,
        name,
        type: "US_STOCK",
        pinyin: pinyin !== "*" ? pinyin : undefined,
        defaultGroup: "美股",
        hint: `美股 (${ticker})`,
      });
      continue;
    }
  }

  // 市场权重重排：A股/基金 (0) > 港股 (1) > 美股 (2)
  // 确保同名跨市场（如“中国银行”）优先呈现 A 股主板，避免误选美股 ADR
  const MARKET_PRIORITY: Record<string, number> = {
    A_SHARE: 0,
    HK_STOCK: 1,
    US_STOCK: 2,
    CRYPTO: 3,
    ALPHA_TOKEN: 4,
  };
  results.sort((a, b) => (MARKET_PRIORITY[a.type] ?? 9) - (MARKET_PRIORITY[b.type] ?? 9));

  return results;
}

/**
 * 按关键字（证券代码 / 中文名 / 拼音缩写）联想检索标的（仅支持 A股 / 港股 / 美股 / 基金）
 * Binance 与 DEX Alpha 维持原有的代码/币对/合约直接输入方式，不接入此处的联想检索
 * 内部自持 60s TTL 缓存与防抖支持
 */
export async function searchSymbols(
  query: string,
  customNetworkOpts?: { mode?: "direct" | "proxy"; proxyUrl?: string }
): Promise<SearchResultItem[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  // 明确排除链上 DEX 合约地址或显式加密货币币对（如 BTCUSDT），避免浪费腾讯股票接口请求
  if (isContractAddress(trimmed) || /^[a-zA-Z0-9]+(?:USDT|USDC|FDUSD)$/i.test(trimmed)) {
    return [];
  }

  const cacheKey = trimmed.toLowerCase();
  const cached = _searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL_MS) {
    return cached.items;
  }

  // 组装出网参数，优先遵循 A股 板块网络设置（Smartbox 位于腾讯国内域名）
  const config = readConfig();
  const netOpts: { mode: "direct" | "proxy"; proxyUrl?: string } = {
    mode: customNetworkOpts?.mode ?? config.aShare?.networkMode ?? "direct",
    ...(customNetworkOpts?.proxyUrl || config.aShare?.proxyUrl ? { proxyUrl: customNetworkOpts?.proxyUrl || config.aShare?.proxyUrl } : {}),
  };

  const url = `${TENCENT_SMARTBOX_URL}?t=all&q=${encodeURIComponent(trimmed)}`;

  try {
    const res = await smartNetworkGet<ArrayBuffer>(url, netOpts, {
      responseType: "arraybuffer",
      timeout: 3500,
    });

    let rawText = "";
    const data: unknown = res.data;
    if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      rawText = decodeGbk(data);
    } else if (typeof data === "string") {
      rawText = data;
    } else {
      rawText = String(data || "");
    }

    const items = parseSmartboxResponse(rawText);

    // 写入内存短期缓存
    if (_searchCache.size >= MAX_SEARCH_CACHE_SIZE) {
      // 清除最老的一半条目
      const keys = Array.from(_searchCache.keys());
      for (let i = 0; i < Math.floor(keys.length / 2); i++) {
        const k = keys[i];
        if (k) _searchCache.delete(k);
      }
    }
    _searchCache.set(cacheKey, { timestamp: Date.now(), items });

    return items;
  } catch (err: unknown) {
    logger.debug(`[symbolSearchService] search failed for query "${trimmed}":`, err);
    return [];
  }
}
