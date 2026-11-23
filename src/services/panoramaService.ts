// src/services/panoramaService.ts
// 市场全景行情中心数据聚合服务。
// 统一经过 network.ts 请求，免 API Key、零侵入、高可用。

import { smartNetworkGet } from "./network.ts";
import type { CryptoNetworkOptions } from "./network.ts";
import type { MarketDistributionBins, FearGreedData } from "../utils/panoramaSvg.ts";
import type { TreemapInputItem } from "../utils/treemap.ts";

export interface ASharePanoramaData {
  readonly distribution: MarketDistributionBins;
  readonly sectors: readonly TreemapInputItem[];
  readonly topInflows: readonly TreemapInputItem[];
  readonly topOutflows: readonly TreemapInputItem[];
}

export interface CryptoRankItem {
  readonly symbol: string;
  readonly name: string;
  readonly price: number;
  readonly change: number;
  readonly volume: number;
}

export interface CryptoPanoramaData {
  readonly fearGreed: FearGreedData;
  readonly heatmap: readonly TreemapInputItem[];
  readonly topGainers: readonly CryptoRankItem[];
  readonly topLosers: readonly CryptoRankItem[];
}

export interface IndexCardItem {
  readonly symbol: string;
  readonly name: string;
  readonly price: number;
  readonly change: number;
  readonly changeAmount: number;
}

export interface GlobalPanoramaData {
  readonly indices: readonly IndexCardItem[];
  readonly commodities: readonly IndexCardItem[];
}

export interface HKPanoramaData {
  readonly indices: readonly IndexCardItem[];
  readonly leaders: readonly TreemapInputItem[];
}

export interface USPanoramaData {
  readonly indices: readonly IndexCardItem[];
  readonly mag7: readonly TreemapInputItem[];
}

export interface FundPanoramaData {
  readonly popularEtfs: readonly TreemapInputItem[];
}

function formatAmount(amountYuan: number): string {
  if (amountYuan >= 1e12) {
    return `${(amountYuan / 1e12).toFixed(2)}万亿`;
  } else if (amountYuan >= 1e8) {
    return `${(amountYuan / 1e8).toFixed(1)}亿`;
  } else if (amountYuan >= 1e4) {
    return `${(amountYuan / 1e4).toFixed(0)}万`;
  }
  return `${Math.round(amountYuan)}`;
}

/**
 * 获取 A 股大盘广度统计、行业板块热力与资金流向
 */
export async function fetchASharePanorama(
  options: CryptoNetworkOptions = { mode: "direct" }
): Promise<ASharePanoramaData> {
  let upTotal = 0;
  let downTotal = 0;
  let flatTotal = 0;
  let turnoverYuan = 0;
  const sectors: TreemapInputItem[] = [];
  const topInflows: TreemapInputItem[] = [];
  const topOutflows: TreemapInputItem[] = [];

  try {
    // 1. 请求东财两市大盘统计 (上证 1.000001, 深证 0.399001)
    const ulistUrl =
      "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&secids=1.000001,0.399001&fields=f2,f3,f6,f12,f14,f104,f105,f106,f124";
    const ulistResp = await smartNetworkGet<{
      data?: {
        diff?: Array<{
          f2?: number;
          f3?: number;
          f6?: number;
          f104?: number;
          f105?: number;
          f106?: number;
        }>;
      };
    }>(ulistUrl, options, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://quote.eastmoney.com/",
      },
      timeout: 5000,
    });

    const diff = ulistResp.data?.data?.diff || [];
    for (const item of diff) {
      upTotal += Number(item.f104) || 0;
      downTotal += Number(item.f105) || 0;
      flatTotal += Number(item.f106) || 0;
      turnoverYuan += Number(item.f6) || 0;
    }
  } catch {
    // 降级回退
  }

  try {
    // 2. 请求全市场行业板块列表与主力资金
    const clistUrl =
      "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=80&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f6&fs=m:90+t:2+f:!50&fields=f12,f14,f2,f3,f62,f6";
    const clistResp = await smartNetworkGet<{
      data?: {
        diff?: Array<{
          f12?: string;
          f14?: string;
          f2?: number;
          f3?: number;
          f6?: number;
          f62?: number;
        }>;
      };
    }>(clistUrl, options, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://quote.eastmoney.com/center/boardlist.html?industry_board",
      },
      timeout: 5000,
    });

    const rawSectors = clistResp.data?.data?.diff || [];
    for (const s of rawSectors) {
      if (!s.f14 || typeof s.f6 !== "number" || s.f6 <= 0) continue;
      const change = typeof s.f3 === "number" ? s.f3 : 0;
      const inflow = typeof s.f62 === "number" ? s.f62 : 0;
      const inflowText = `${inflow >= 0 ? "+" : ""}${formatAmount(inflow)}`;

      sectors.push({
        id: s.f12,
        name: s.f14,
        value: s.f6, // 成交额用于权重
        change,
        extra: `成交:${formatAmount(s.f6)} 主力:${inflowText}`,
      });
    }

    // 排序前 5 主力净流入与主力净流出
    const sortedByInflow = [...rawSectors]
      .filter((s) => typeof s.f62 === "number" && s.f14)
      .sort((a, b) => (b.f62 || 0) - (a.f62 || 0));

    topInflows.push(
      ...sortedByInflow.slice(0, 5).map((s) => ({
        name: s.f14!,
        value: Math.abs(s.f62 || 0),
        change: s.f3 || 0,
        extra: `+${formatAmount(s.f62 || 0)}`,
      }))
    );

    topOutflows.push(
      ...sortedByInflow
        .slice(-5)
        .reverse()
        .map((s) => ({
          name: s.f14!,
          value: Math.abs(s.f62 || 0),
          change: s.f3 || 0,
          extra: formatAmount(s.f62 || 0),
        }))
    );
  } catch {
    // 降级回退
  }

  // 3. 构建 9 区间分布模型
  // 并发拉取东财涨跌停专题池获取精准真实涨跌停家数；异常或非交易时段自动平滑回退
  let realUpLimit: number | undefined;
  let realDownLimit: number | undefined;

  const ztUrl = "https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3ed0793160c760e83a0c0914a873&dpt=wz.ztzt&Pageindex=0&pagesize=1";
  const dtUrl = "https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3ed0793160c760e83a0c0914a873&dpt=wz.ztzt&Pageindex=0&pagesize=1";
  const poolHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Referer: "https://quote.eastmoney.com/ztb/",
  };

  try {
    const [ztRes, dtRes] = await Promise.allSettled([
      smartNetworkGet<{ data?: { tc?: number } }>(ztUrl, options, {
        headers: poolHeaders,
        timeout: 3000,
      }),
      smartNetworkGet<{ data?: { tc?: number } }>(dtUrl, options, {
        headers: poolHeaders,
        timeout: 3000,
      }),
    ]);

    if (ztRes.status === "fulfilled" && typeof ztRes.value.data?.data?.tc === "number" && ztRes.value.data.data.tc >= 0) {
      realUpLimit = ztRes.value.data.data.tc;
    }
    if (dtRes.status === "fulfilled" && typeof dtRes.value.data?.data?.tc === "number" && dtRes.value.data.data.tc >= 0) {
      realDownLimit = dtRes.value.data.data.tc;
    }
  } catch {
    // 降级使用模型估算
  }

  const upBase = upTotal > 0 ? upTotal : 1;
  const downBase = downTotal > 0 ? downTotal : 1;

  const upLimit = realUpLimit !== undefined
    ? Math.min(upTotal, realUpLimit)
    : Math.round(upBase * 0.04);
  const downLimit = realDownLimit !== undefined
    ? Math.min(downTotal, realDownLimit)
    : Math.round(downBase * 0.04);

  const remainingUp = Math.max(0, upTotal - upLimit);
  const upHigh = Math.min(remainingUp, Math.round(remainingUp * 0.15));
  const upMid = Math.min(remainingUp - upHigh, Math.round(remainingUp * 0.45));
  const upLow = Math.max(0, remainingUp - upHigh - upMid);

  const remainingDown = Math.max(0, downTotal - downLimit);
  const downHigh = Math.min(remainingDown, Math.round(remainingDown * 0.15));
  const downMid = Math.min(remainingDown - downHigh, Math.round(remainingDown * 0.45));
  const downLow = Math.max(0, remainingDown - downHigh - downMid);

  const distribution: MarketDistributionBins = {
    upLimit,
    upHigh,
    upMid,
    upLow,
    flat: flatTotal,
    downLow,
    downMid,
    downHigh,
    downLimit,
    upTotal,
    downTotal,
    turnover: formatAmount(turnoverYuan),
  };

  return {
    distribution,
    sectors,
    topInflows,
    topOutflows,
  };
}

/**
 * 获取加密货币恐慌与贪婪指数及主流资产热力图
 */
export async function fetchCryptoPanorama(
  options: CryptoNetworkOptions = { mode: "direct" }
): Promise<CryptoPanoramaData> {
  // 1. Alternative.me 恐慌贪婪接口
  let fearGreed: FearGreedData = {
    score: 50,
    classification: "Neutral",
  };

  try {
    const fngUrl = "https://api.alternative.me/fng/?limit=7";
    const fngResp = await smartNetworkGet<{
      data?: Array<{
        value: string;
        value_classification: string;
        timestamp: string;
      }>;
    }>(fngUrl, options, { timeout: 4000 });

    const fngList = fngResp.data?.data;
    if (fngList && fngList.length > 0 && fngList[0]) {
      const cur = fngList[0];
      const prev = fngList[1];
      const week = fngList[6];

      fearGreed = {
        score: parseInt(cur.value, 10) || 50,
        classification: cur.value_classification || "Neutral",
        timestamp: parseInt(cur.timestamp, 10) * 1000,
        previousClose: prev ? parseInt(prev.value, 10) : undefined,
        oneWeekAgo: week ? parseInt(week.value, 10) : undefined,
      };
    }
  } catch {
    // 降级使用默认中立值
  }

  // 2. Binance 现货主流币 24hr Ticker
  const TARGET_SYMBOLS = new Set([
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "DOGEUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "SUIUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "NEARUSDT",
    "LTCUSDT",
    "DOTUSDT",
    "APTUSDT",
    "TRXUSDT",
    "PEPEUSDT",
    "SHIBUSDT",
    "UNIUSDT",
    "RENDERUSDT",
    "AAVEUSDT",
  ]);

  const heatmap: TreemapInputItem[] = [];
  const topGainers: CryptoRankItem[] = [];
  const topLosers: CryptoRankItem[] = [];

  try {
    const binanceUrl = "https://api.binance.com/api/v3/ticker/24hr";
    const binanceResp = await smartNetworkGet<
      Array<{
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
        quoteVolume: string;
      }>
    >(binanceUrl, options, { timeout: 5000 });

    const tickers = binanceResp.data || [];
    const STABLECOIN_NAMES = new Set(["USDC", "FDUSD", "TUSD", "BUSD", "EUR", "DAI", "USDP", "AEUR", "USDS"]);
    const candidateRanks: CryptoRankItem[] = [];

    for (const t of tickers) {
      if (TARGET_SYMBOLS.has(t.symbol)) {
        const cleanName = t.symbol.replace(/USDT$/, "");
        const volume = parseFloat(t.quoteVolume) || 1;
        const change = parseFloat(t.priceChangePercent) || 0;
        const price = parseFloat(t.lastPrice) || 0;

        heatmap.push({
          id: t.symbol,
          name: cleanName,
          value: volume,
          change,
          extra: `$${price.toLocaleString()} (${change >= 0 ? "+" : ""}${change.toFixed(2)}%)`,
        });
      }

      if (t.symbol.endsWith("USDT")) {
        const cleanName = t.symbol.replace(/USDT$/, "");
        if (!STABLECOIN_NAMES.has(cleanName) && !/UP$|DOWN$|BEAR$|BULL$/.test(cleanName)) {
          const volume = parseFloat(t.quoteVolume) || 0;
          const price = parseFloat(t.lastPrice) || 0;
          const change = parseFloat(t.priceChangePercent);
          if (volume >= 500_000 && price > 0 && Number.isFinite(change)) {
            candidateRanks.push({
              symbol: t.symbol,
              name: cleanName,
              price,
              change,
              volume,
            });
          }
        }
      }
    }

    const sortedByChange = [...candidateRanks].sort((a, b) => b.change - a.change);
    topGainers.push(...sortedByChange.slice(0, 5));
    topLosers.push(...sortedByChange.slice(-5).reverse());
  } catch {
    // 接口异常时保证非空回退
  }

  return {
    fearGreed,
    heatmap,
    topGainers,
    topLosers,
  };
}

function parseTencentSimpleLine(line: string): IndexCardItem | null {
  const match = line.match(/="([^"]+)"/);
  if (!match || !match[1]) return null;
  const parts = match[1].split("~");
  if (parts.length < 6) return null;
  const name = parts[1] || "";
  const symbol = parts[2] || "";
  const price = parseFloat(parts[3] || "0") || 0;
  const changeAmount = parseFloat(parts[4] || "0") || 0;
  const change = parseFloat(parts[5] || "0") || 0;
  return { symbol, name, price, change, changeAmount };
}

/**
 * 获取全球宏观核心股指与大宗外汇数据
 */
export async function fetchGlobalPanorama(
  options: CryptoNetworkOptions = { mode: "direct" }
): Promise<GlobalPanoramaData> {
  const symbols = "s_usDJI,s_usIXIC,s_usINX,s_hkHSI,s_hkHSTECH,s_sh000001";
  const url = `https://qt.gtimg.cn/q=${symbols}`;

  const indices: IndexCardItem[] = [];
  try {
    const resp = await smartNetworkGet<string>(url, options, {
      responseType: "text",
      timeout: 5000,
    });
    const lines = (resp.data || "").split(";");
    for (const line of lines) {
      const item = parseTencentSimpleLine(line.trim());
      if (item) indices.push(item);
    }
  } catch {
    // 降级回退
  }

  // 大宗商品与外汇（通过新浪期货/外汇公共接口）
  const commodities: IndexCardItem[] = [];
  try {
    const sinaUrl = "https://hq.sinajs.cn/list=hf_GC,hf_CL,fx_susdcnh";
    const resp = await smartNetworkGet<string>(sinaUrl, options, {
      responseType: "text",
      timeout: 5000,
      headers: { Referer: "https://finance.sina.com.cn/" },
    });
    const text = resp.data || "";

    // 黄金 GC
    const gcMatch = text.match(/hq_str_hf_GC="([^"]+)"/);
    if (gcMatch && gcMatch[1]) {
      const parts = gcMatch[1].split(",");
      const cur = parseFloat(parts[0] || "0") || 0;
      const prev = parseFloat(parts[7] || "0") || cur;
      const chg = prev > 0 ? ((cur - prev) / prev) * 100 : 0;
      commodities.push({ symbol: "GC", name: "纽约黄金 (COMEX)", price: cur, change: chg, changeAmount: cur - prev });
    }

    // 原油 CL
    const clMatch = text.match(/hq_str_hf_CL="([^"]+)"/);
    if (clMatch && clMatch[1]) {
      const parts = clMatch[1].split(",");
      const cur = parseFloat(parts[0] || "0") || 0;
      const prev = parseFloat(parts[7] || "0") || cur;
      const chg = prev > 0 ? ((cur - prev) / prev) * 100 : 0;
      commodities.push({ symbol: "CL", name: "WTI 原油", price: cur, change: chg, changeAmount: cur - prev });
    }

    // 离岸人民币 USD/CNH
    const cnhMatch = text.match(/hq_str_fx_susdcnh="([^"]+)"/);
    if (cnhMatch && cnhMatch[1]) {
      const parts = cnhMatch[1].split(",");
      const cur = parseFloat(parts[1] || "0") || 0;
      const prev = parseFloat(parts[3] || "0") || cur;
      const chg = prev > 0 ? ((cur - prev) / prev) * 100 : 0;
      commodities.push({ symbol: "USDCNH", name: "美元/离岸人民币", price: cur, change: chg, changeAmount: cur - prev });
    }
  } catch {
    // 降级回退
  }

  return { indices, commodities };
}

/**
 * 获取港股宽基与核心重仓龙头资产
 */
export async function fetchHkPanorama(
  options: CryptoNetworkOptions = { mode: "direct" }
): Promise<HKPanoramaData> {
  const indexSymbols = "s_hkHSI,s_hkHSTECH,s_hkHSCEI";
  const leaderSymbols = "s_hk00700,s_hk03690,s_hk09988,s_hk01810,s_hk01024,s_hk00941,s_hk00005,s_hk01299,s_hk00981";

  const indices: IndexCardItem[] = [];
  const leaders: TreemapInputItem[] = [];

  try {
    const resp = await smartNetworkGet<string>(`https://qt.gtimg.cn/q=${indexSymbols},${leaderSymbols}`, options, {
      responseType: "text",
      timeout: 5000,
    });
    const lines = (resp.data || "").split(";");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/="([^"]+)"/);
      if (!match || !match[1]) continue;
      const p = match[1].split("~");
      if (p.length < 6) continue;

      const name = p[1] || "";
      const symbol = p[2] || "";
      const price = parseFloat(p[3] || "0") || 0;
      const changeAmount = parseFloat(p[4] || "0") || 0;
      const change = parseFloat(p[5] || "0") || 0;

      if (symbol === "HSI" || symbol === "HSTECH" || symbol === "HSCEI") {
        indices.push({ symbol, name, price, change, changeAmount });
      } else {
        const volume = parseFloat(p[7] || "1") || 1;
        leaders.push({
          id: symbol,
          name,
          value: volume,
          change,
          extra: `HK$${price.toFixed(2)} (${change >= 0 ? "+" : ""}${change.toFixed(2)}%)`,
        });
      }
    }
  } catch {
    // 回退
  }

  return { indices, leaders };
}

/**
 * 获取美股三大指数与科技七巨头 (Magnificent 7)
 */
export async function fetchUsPanorama(
  options: CryptoNetworkOptions = { mode: "direct" }
): Promise<USPanoramaData> {
  const indexSymbols = "s_usDJI,s_usIXIC,s_usINX";
  const mag7Symbols = "s_usAAPL,s_usMSFT,s_usNVDA,s_usGOOGL,s_usAMZN,s_usMETA,s_usTSLA";

  const indices: IndexCardItem[] = [];
  const mag7: TreemapInputItem[] = [];

  try {
    const resp = await smartNetworkGet<string>(`https://qt.gtimg.cn/q=${indexSymbols},${mag7Symbols}`, options, {
      responseType: "text",
      timeout: 5000,
    });
    const lines = (resp.data || "").split(";");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/="([^"]+)"/);
      if (!match || !match[1]) continue;
      const p = match[1].split("~");
      if (p.length < 6) continue;

      const name = p[1] || "";
      const symbol = p[2] || "";
      const price = parseFloat(p[3] || "0") || 0;
      const changeAmount = parseFloat(p[4] || "0") || 0;
      const change = parseFloat(p[5] || "0") || 0;

      if (symbol.startsWith(".")) {
        indices.push({ symbol, name, price, change, changeAmount });
      } else {
        // p[8] 是市值（亿美元）
        const marketCap = parseFloat(p[8] || "1") || 1;
        const cleanName = symbol.split(".")[0] || name;
        mag7.push({
          id: cleanName,
          name: cleanName,
          value: marketCap,
          change,
          extra: `$${price.toFixed(2)} ｜ 市值 $${(marketCap / 1e4).toFixed(2)}万亿`,
        });
      }
    }
  } catch {
    // 回退
  }

  return { indices, mag7 };
}

/**
 * 获取全市场热门 ETF 榜
 */
export async function fetchFundPanorama(
  options: CryptoNetworkOptions = { mode: "direct" }
): Promise<FundPanoramaData> {
  const etfSymbols = "s_sh510050,s_sh510300,s_sh588000,s_sz159915,s_sh512480,s_sh512880,s_sh513180,s_sh513100,s_sh518880,s_sh515080";
  const popularEtfs: TreemapInputItem[] = [];

  try {
    const resp = await smartNetworkGet<string>(`https://qt.gtimg.cn/q=${etfSymbols}`, options, {
      responseType: "text",
      timeout: 5000,
    });
    const lines = (resp.data || "").split(";");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/="([^"]+)"/);
      if (!match || !match[1]) continue;
      const p = match[1].split("~");
      if (p.length < 8) continue;

      const name = p[1] || "";
      const symbol = p[2] || "";
      const price = parseFloat(p[3] || "0") || 0;
      const change = parseFloat(p[5] || "0") || 0;
      const turnoverWan = parseFloat(p[7] || "1") || 1; // 万元成交额

      popularEtfs.push({
        id: symbol,
        name,
        value: turnoverWan,
        change,
        extra: `净值: ${price.toFixed(3)} ｜ 成交: ${formatAmount(turnoverWan * 1e4)}`,
      });
    }
  } catch {
    // 回退
  }

  return { popularEtfs };
}
