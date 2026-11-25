// src/utils/portfolio.ts
// 持仓总资产总账（Portfolio Summary）的计算单一真相源。
// 状态栏持仓条、侧边栏总览组与 QuickPick 总账浮窗共用本模块，
// 禁止在任何 UI 层就地复制累加/换算公式（AGENTS.md §5.5）。
import type { MarketSection } from "../types";
import type { HoldingItemQuote } from "./symbolHelper.ts";
import { deriveTodayProfit } from "./symbolHelper.ts";
import { logger } from "./logger.ts";

/** 总账基准货币（用户可选，默认 CNY） */
export type PortfolioBaseCurrency = "CNY" | "USD";

/** 持仓条目实际出现的计价货币（与 MarketItem.currency 口径一致） */
export type PortfolioCurrency = "CNY" | "USD" | "HKD" | "USDT" | "BTC" | "ETH";

/** 可按法币汇率折算进基准货币总账的币种（BTC/ETH 计价资产无可靠法币汇率，不参与折算） */
export type FiatPortfolioCurrency = "CNY" | "USD" | "HKD" | "USDT";

export function isFiatConvertibleCurrency(cur: string): cur is FiatPortfolioCurrency {
  return cur === "CNY" || cur === "USD" || cur === "HKD" || cur === "USDT";
}

/**
 * 内置静态参考汇率（对 CNY 的系数），换算兜底真相源。
 * USDT 按 1 USD 锚定。在线实时汇率（fxRateService）拉取失败或失真时，
 * 由 getEffectiveFxRates 自动回退到本组静态参考值。
 *
 * 校准记录：2026-11-13 按新浪外汇实测牌价（USD/CNY 6.6745、HKD/CNY 0.85035）
 * 复核并校准；汇率会随市场变化，需定期复核（见 docs/项目全面体检报告.md 长期关注项）。
 * 禁止在 UI 文案里另写死本组数值，统一用 formatFxDetailNote 插值展示。
 */
export const FX_RATES_TO_CNY: Readonly<Record<FiatPortfolioCurrency, number>> = {
  CNY: 1,
  USD: 6.67,
  HKD: 0.85,
  USDT: 6.67,
};

/**
 * 纯换算：把 from 币种金额折算为 base 基准货币金额。
 * 例：toBaseCurrency(100, "USD", "CNY") = 100 × 当前生效的 USD/CNY；CNY→USD 为逆运算。
 * 不在注释里写死具体牌价，避免与 FX_RATES_TO_CNY / 在线快照漂移。
 */
export function toBaseCurrency(
  value: number,
  from: PortfolioCurrency,
  base: PortfolioBaseCurrency
): number {
  if (!Number.isFinite(value)) return 0;
  // BTC/ETH 计价资产没有可靠法币汇率，不做无依据折算（§5.5）；
  // computePortfolioSummary 会跳过这类桶，此守卫仅兜底直接调用方。
  if (!isFiatConvertibleCurrency(from)) return 0;
  const fx = getEffectiveFxRates();
  const fromRate =
    from === "CNY" ? 1 : from === "HKD" ? fx.hkdToCny : fx.usdToCny;
  const baseRate = base === "USD" ? fx.usdToCny : 1;
  return (value * fromRate) / baseRate;
}

/** 在线实时汇率快照（由 fxRateService 经统一网络出口拉取后注入） */
export interface LiveFxRates {
  usdToCny: number;
  hkdToCny: number;
  fetchedAt: number;
}

/** 当前生效汇率（实时优先，失真/过期/缺失时回退静态参考值） */
export interface EffectiveFxRates extends LiveFxRates {
  usdtToCny: number;
  source: "live" | "static";
}

/** 在线汇率新鲜度上限：超过后视为过期，回退静态参考值（避免陈旧牌价误导估值） */
export const FX_LIVE_STALE_MS = 24 * 60 * 60 * 1000;

// 模块级实时汇率状态（与 maskState 同款注入式模块状态模式；测试经 resetLiveFxRatesForTest 复原）
let liveFxRates: LiveFxRates | undefined;

/**
 * 注入/清除在线实时汇率（fxRateService 唯一写入出口）。
 * 数值必须为有限正数且落在合理区间（USD/CNY ∈ (5,15)、HKD/CNY ∈ (0.5,2)），
 * 明显失真的上游数据一律拒绝（§5.2 外部数据消毒），防止静默错账。
 */
export function setLiveFxRates(live: LiveFxRates | undefined): void {
  if (!live) {
    liveFxRates = undefined;
    return;
  }
  const valid =
    Number.isFinite(live.usdToCny) &&
    live.usdToCny > 5 &&
    live.usdToCny < 15 &&
    Number.isFinite(live.hkdToCny) &&
    live.hkdToCny > 0.5 &&
    live.hkdToCny < 2 &&
    Number.isFinite(live.fetchedAt) &&
    live.fetchedAt > 0;
  if (!valid) {
    logger.warn("[portfolio] 在线汇率数值超出合理区间，已拒绝注入并沿用既有回退");
    return;
  }
  liveFxRates = { usdToCny: live.usdToCny, hkdToCny: live.hkdToCny, fetchedAt: live.fetchedAt };
}

/** 读取当前生效汇率：实时汇率存在且未过期时优先，否则回退静态参考值 */
export function getEffectiveFxRates(): EffectiveFxRates {
  if (
    liveFxRates &&
    Date.now() - liveFxRates.fetchedAt < FX_LIVE_STALE_MS
  ) {
    return {
      usdToCny: liveFxRates.usdToCny,
      hkdToCny: liveFxRates.hkdToCny,
      usdtToCny: liveFxRates.usdToCny,
      fetchedAt: liveFxRates.fetchedAt,
      source: "live",
    };
  }
  return {
    usdToCny: FX_RATES_TO_CNY.USD,
    hkdToCny: FX_RATES_TO_CNY.HKD,
    usdtToCny: FX_RATES_TO_CNY.USDT,
    fetchedAt: 0,
    source: "static",
  };
}

/** 仅测试使用：清空注入的实时汇率，恢复静态参考值口径 */
export function resetLiveFxRatesForTest(): void {
  liveFxRates = undefined;
}

/**
 * 汇率来源说明文案（总账各 UI 入口共享的单一展示出口）。
 * 在线汇率显示「在线牌价（更新于 HH:mm 或 M月D日 HH:mm）」，静态回退显示「静态参考值兜底」。
 * 24h 有效期内可能跨天，因此非当天快照必须带日期，避免把昨天的牌价读成今天。
 */
export function formatFxSourceNote(fx: EffectiveFxRates): string {
  if (fx.source === "live" && fx.fetchedAt > 0) {
    const fetched = new Date(fx.fetchedAt);
    const hhmm = fetched.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const now = new Date();
    const sameDay =
      fetched.getFullYear() === now.getFullYear() &&
      fetched.getMonth() === now.getMonth() &&
      fetched.getDate() === now.getDate();
    const stamp = sameDay
      ? hhmm
      : `${fetched.getMonth() + 1}月${fetched.getDate()}日 ${hhmm}`;
    return `在线牌价（更新于 ${stamp}）`;
  }
  return "静态参考值兜底";
}

/**
 * 汇率明细说明（总账各 UI 入口共享的单一展示出口）。
 * UI 不得自行拼装牌价数字，避免与 FX_RATES_TO_CNY / 实时快照漂移；
 * 静态兜底时明确提示可能与实时牌价有偏差，不把内置参考值伪装成实时汇率。
 */
export function formatFxDetailNote(fx: EffectiveFxRates): string {
  // 上游牌价精度可达 10 位小数（如 0.8500293260），展示时收口到 6 位并去掉尾零，
  // 既保留在线牌价的可辨识度，又不会把 Tooltip / QuickPick 撑爆。
  const fmt = (v: number): string =>
    Number.isFinite(v) ? Number(v.toFixed(6)).toString() : "—";
  const rates = `USD/CNY ${fmt(fx.usdToCny)}、HKD/CNY ${fmt(fx.hkdToCny)}、USDT=USD`;
  return fx.source === "live"
    ? `${rates}，仅作估值参考`
    : `${rates}，为内置静态参考值、可能与实时牌价存在偏差，仅作估值参考`;
}

/** 币种原生聚合桶（自 statusBar 迁移导出的对账口径，形状保持不变） */
export interface HoldingCurrencyBucket {
  todayProfit: number;
  totalProfit: number;
  count: number;
  marketVal: number;
  costVal: number;
}

/**
 * 有效持仓谓词（录入校验 / 导入消毒 / 总账聚合三端共享的唯一口径）：
 * cost 允许 0（赠股等零成本持仓合法），shares 必须为正，price 非负，全部有限。
 */
export function isValidHoldingQuote(h: HoldingItemQuote): boolean {
  return (
    Number.isFinite(h.cost) && h.cost >= 0 &&
    Number.isFinite(h.shares) && h.shares > 0 &&
    Number.isFinite(h.price) && h.price >= 0
  );
}

/**
 * 按计价币种原生聚合持仓——状态栏 `aggregateHoldings` 的委托出口。
 * 今日盈亏经 `deriveTodayProfit` 单一实现（AGENTS.md §5.5）。
 */
export function aggregateHoldingsByCurrency(
  holdings: readonly HoldingItemQuote[]
): Map<string, HoldingCurrencyBucket> {
  const currencyMap = new Map<string, HoldingCurrencyBucket>();
  for (const h of holdings) {
    // 防御性校验：过滤脏数据或未预处理的非有限数值，防止乘法破坏账务汇总
    if (!isValidHoldingQuote(h)) {
      continue;
    }
    const cur = h.currency || "CNY";
    let data = currencyMap.get(cur);
    if (!data) {
      data = { todayProfit: 0, totalProfit: 0, count: 0, marketVal: 0, costVal: 0 };
      currencyMap.set(cur, data);
    }
    data.count++;
    data.costVal += h.cost * h.shares;
    data.marketVal += h.price * h.shares;
    data.totalProfit += (h.price - h.cost) * h.shares;
    data.todayProfit += deriveTodayProfit(h, h.shares);
  }
  return currencyMap;
}

/** 板块维度的总账聚合桶（已折算为基准货币） */
export interface PortfolioSectionBucket {
  marketVal: number;
  costVal: number;
  todayProfit: number;
  totalProfit: number;
  count: number;
}

/** 持仓总账汇总结果 */
export interface PortfolioSummary {
  /** 基准货币 */
  base: PortfolioBaseCurrency;
  /** 全账户合计（基准货币） */
  total: PortfolioSectionBucket;
  /** 板块分布（基准货币）；中立分组（section 缺失）的标的仅计入 total */
  bySection: Partial<Record<MarketSection, PortfolioSectionBucket>>;
  /** 各原生币种对账明细（未折算，供 Tooltip 与状态栏看板沿用既有口径） */
  byCurrency: Record<string, HoldingCurrencyBucket>;
  /** 本次折算实际生效的汇率与来源（实时/静态），供 UI 展示数据时效 */
  fx: EffectiveFxRates;
  /** 有效持仓标的数 */
  holdingsCount: number;
}

/** 总账计算输入：持仓条目（含板块归属，可缺省） */
export type PortfolioHoldingInput = HoldingItemQuote & { section?: MarketSection | undefined };

/** 新建空聚合桶 */
function emptyBucket(): PortfolioSectionBucket {
  return { marketVal: 0, costVal: 0, todayProfit: 0, totalProfit: 0, count: 0 };
}

/**
 * 总账金额格式化（支持亿/万简写；总账各 UI 入口共享的单一展示出口）。
 * 恒返回绝对值，符号由调用方按语义拼接，避免正负号重复。
 */
export function formatPortfolioAmount(val: number): string {
  const abs = Math.abs(val);
  if (!Number.isFinite(abs)) return "0.00";
  if (abs >= 1e8) return `${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(abs / 1e4).toFixed(2)}万`;
  if (abs < 0.01 && abs > 0) return abs.toFixed(4);
  return abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 盈亏率计算所需字段（PortfolioSectionBucket 与 HoldingCurrencyBucket 均结构兼容） */
export interface PortfolioRateSource {
  marketVal: number;
  costVal: number;
  todayProfit: number;
  totalProfit: number;
}

/**
 * 今日盈亏率（%）。分母是**昨收市值**（当前市值 − 今日盈亏），不是持仓本金：
 * 用本金会把长期持仓的日涨跌幅按浮盈倍数放大或缩小。
 * 例：成本 100 / 昨收 198 / 现价 200 / 今日 +2 → 2/198 ≈ 1.01%，而非 2/100 = 2%。
 */
export function deriveTodayProfitRate(bucket: PortfolioRateSource): number {
  const prevMarketVal = bucket.marketVal - bucket.todayProfit;
  return prevMarketVal > 0 && Number.isFinite(prevMarketVal)
    ? (bucket.todayProfit / prevMarketVal) * 100
    : 0;
}

/** 累计浮盈率（%）：分母为持仓本金，为零/非法时回落 0，不产生 NaN */
export function deriveTotalProfitRate(bucket: PortfolioRateSource): number {
  return bucket.costVal > 0 ? (bucket.totalProfit / bucket.costVal) * 100 : 0;
}

/**
 * 持仓总账唯一计算出口：跨币种统一折算为基准货币并按板块分桶。
 *
 * - `byCurrency` 保持原生币种累加（与既有状态栏对账口径完全一致）；
 * - `bySection` / `total` 按原生币种桶一次性线性换算（与逐标的换算数学等价）；
 * - 今日盈亏内部调用 `deriveTodayProfit`，禁止调用方另行复制公式。
 */
export function computePortfolioSummary(
  holdings: readonly PortfolioHoldingInput[],
  base: PortfolioBaseCurrency
): PortfolioSummary {
  const byCurrencyMap = aggregateHoldingsByCurrency(holdings);

  // 原生币种桶 → 基准货币桶（线性换算）
  const total = emptyBucket();
  const bySection: Partial<Record<MarketSection, PortfolioSectionBucket>> = {};

  const sectionNative = new Map<MarketSection, Map<string, HoldingCurrencyBucket>>();

  for (const h of holdings) {
    // 与 aggregateHoldingsByCurrency 同一谓词：否则脏输入时 total ≠ ΣbySection
    if (!h.section || !isValidHoldingQuote(h)) continue;
    let perSection = sectionNative.get(h.section);
    if (!perSection) {
      perSection = new Map<string, HoldingCurrencyBucket>();
      sectionNative.set(h.section, perSection);
    }
    let bucket = perSection.get(h.currency || "CNY");
    if (!bucket) {
      bucket = { todayProfit: 0, totalProfit: 0, count: 0, marketVal: 0, costVal: 0 };
      perSection.set(h.currency || "CNY", bucket);
    }
    bucket.count++;
    bucket.costVal += h.cost * h.shares;
    bucket.marketVal += h.price * h.shares;
    bucket.totalProfit += (h.price - h.cost) * h.shares;
    bucket.todayProfit += deriveTodayProfit(h, h.shares);
  }

  const byCurrency: Record<string, HoldingCurrencyBucket> = {};
  for (const [cur, native] of byCurrencyMap) {
    byCurrency[cur] = native;
    // BTC/ETH 计价持仓保留原生币种桶供对账展示，但不折算进基准货币总账（无法币汇率依据，§5.5）
    if (!isFiatConvertibleCurrency(cur)) continue;
    total.marketVal += toBaseCurrency(native.marketVal, cur, base);
    total.costVal += toBaseCurrency(native.costVal, cur, base);
    total.todayProfit += toBaseCurrency(native.todayProfit, cur, base);
    total.totalProfit += toBaseCurrency(native.totalProfit, cur, base);
    total.count += native.count;
  }

  for (const [section, perSection] of sectionNative) {
    const bucket = emptyBucket();
    for (const [cur, native] of perSection) {
      if (!isFiatConvertibleCurrency(cur)) continue;
      bucket.marketVal += toBaseCurrency(native.marketVal, cur, base);
      bucket.costVal += toBaseCurrency(native.costVal, cur, base);
      bucket.todayProfit += toBaseCurrency(native.todayProfit, cur, base);
      bucket.totalProfit += toBaseCurrency(native.totalProfit, cur, base);
      bucket.count += native.count;
    }
    bySection[section] = bucket;
  }

  return {
    base,
    total,
    bySection,
    byCurrency,
    fx: getEffectiveFxRates(),
    holdingsCount: holdings.filter(isValidHoldingQuote).length,
  };
}
