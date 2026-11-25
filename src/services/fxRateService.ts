// src/services/fxRateService.ts
// 在线实时汇率拉取服务（新浪财经外汇接口），供持仓总账跨币种折算使用。
// 失败/失真时返回 undefined，由调用方静默回退 portfolio.ts 的静态参考值（§5.2 外部数据消毒）。
import { smartNetworkGet } from "./network.ts";
import { decodeGbk } from "../utils/symbolHelper.ts";
import { readConfig } from "../utils/config.ts";
import { logger } from "../utils/logger.ts";
import type { LiveFxRates } from "../utils/portfolio.ts";

/**
 * 新浪外汇批量接口：一次请求取美元/在岸人民币、港元/人民币、美元/港元。
 * 必须携带 Referer: https://finance.sina.com.cn，否则上游拒绝（403）。
 */
export const SINA_FX_URL = "https://hq.sinajs.cn/list=fx_susdcny,fx_shkdcny,fx_susdhkd";

/** 新浪外汇报文「最新价」字段下标；不可用时回退 [1]（买价报价字段，实测与 [8] 同值；开盘价在 [5]） */
const FX_PRICE_FIELD_INDEX = 8;
const FX_FALLBACK_FIELD_INDEX = 1;

/**
 * 从新浪外汇报文中提取单个代码的最新价。
 * 报文形如 `hq_str_fx_susdcny="03:00:00,6.6700,...,6.6745,...,在岸人民币,..."`（GBK）。
 * 字段缺失/占位（空串、"-"、"-1"）与非法数值一律返回 undefined，禁止 `|| 0` 伪装成真实零值。
 */
export function extractFxPrice(text: string, code: string): number | undefined {
  const match = text.match(new RegExp(`hq_str_${code}="([^"]*)"`));
  if (!match) return undefined;
  const fields = match[1].split(",");
  const raw =
    fields.length > FX_PRICE_FIELD_INDEX ? fields[FX_PRICE_FIELD_INDEX] : undefined;
  let n = parseFxFloat(raw);
  if (n === undefined && fields.length > FX_FALLBACK_FIELD_INDEX) {
    n = parseFxFloat(fields[FX_FALLBACK_FIELD_INDEX]);
  }
  return n;
}

/** 外汇字段浮点解析：空串/占位/非有限值返回 undefined */
function parseFxFloat(val: string | undefined): number | undefined {
  if (!val || val === "-" || val === "-1") return undefined;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 解析新浪外汇批量报文（GBK 解码后的文本）为实时汇率快照。
 *
 * - usdcny 必需；hkdcny 缺失时可由 usdcny / usdhkd 交叉推导；
 * - 数值超出合理区间（USD/CNY ∈ (5,15)、HKD/CNY ∈ (0.5,2)）视为上游失真，整体拒绝；
 * - 任一必要汇率不可得时返回 undefined，调用方沿用静态参考值回退。
 */
export function parseSinaFxResponse(text: string): LiveFxRates | undefined {
  if (!text || text.indexOf("hq_str_fx_") === -1) return undefined;

  const usdToCny = extractFxPrice(text, "fx_susdcny");
  if (usdToCny === undefined) return undefined;

  let hkdToCny = extractFxPrice(text, "fx_shkdcny");
  if (hkdToCny === undefined) {
    const usdToHkd = extractFxPrice(text, "fx_susdhkd");
    if (usdToHkd !== undefined && usdToHkd > 0) {
      hkdToCny = usdToCny / usdToHkd;
    }
  }
  if (hkdToCny === undefined) return undefined;

  if (!(usdToCny > 5 && usdToCny < 15 && hkdToCny > 0.5 && hkdToCny < 2)) {
    logger.warn("[fxRateService] 新浪外汇数值超出合理区间，已丢弃本次快照");
    return undefined;
  }

  return { usdToCny, hkdToCny, fetchedAt: Date.now() };
}

/** 汇率请求的网络出口配置（与 ipoService.getNetworkOptions 同款形状） */
export interface FxNetworkOptions {
  mode: "proxy" | "direct";
  proxyUrl?: string;
}

/**
 * 调用方未显式指定时，从用户配置读取网络模式与代理地址。
 *
 * 汇率请求必须和行情请求一样遵从设置面板的代理配置：此前默认 `{ mode: "direct" }`，
 * 而 scheduler 是无参注入的，导致「用户配了代理、汇率却永远直连」——在只能走代理的
 * 网络里会静默退化为静态兜底汇率，且界面上只提示「静态参考值兜底」，难以定位。
 * 沿用 A 股板块的网络模式作为全局出口口径（与 ipoService 一致）。
 *
 * 导出仅供契约测试使用；生产链路统一走 fetchLiveFxRates 无参调用。
 */
export function resolveFxNetworkOptions(): FxNetworkOptions {
  try {
    const config = readConfig();
    const mode: "proxy" | "direct" = config.aShare?.networkMode === "proxy" ? "proxy" : "direct";
    const proxyUrl = config.aShare?.proxyUrl || config.proxyUrl;
    return proxyUrl ? { mode, proxyUrl } : { mode };
  } catch (err) {
    // 配置读取异常不应连带放弃汇率请求，降级直连后照常尝试
    logger.warn("[fxRateService] 读取网络配置失败，本次汇率请求按直连处理", err);
    return { mode: "direct" };
  }
}

let _testFxFetcher: (() => Promise<LiveFxRates | undefined>) | undefined;

/** 测试辅助注入汇率拉取器（供集成测试隔离外网请求） */
export function setFxRateFetcherForTesting(
  fetcher?: () => Promise<LiveFxRates | undefined>
): void {
  _testFxFetcher = fetcher;
}

/**
 * 拉取在线实时汇率（经统一网络出口，支持代理/直连）。
 * 不传 options 时自动遵从用户网络配置；显式传入用于测试或特殊出口覆盖。
 * 任何失败（网络异常、报文失真）均返回 undefined，不抛出——调用方静默回退静态参考值。
 */
export async function fetchLiveFxRates(
  options?: FxNetworkOptions
): Promise<LiveFxRates | undefined> {
  if (_testFxFetcher && !options) {
    return _testFxFetcher();
  }
  try {
    const networkOptions = options ?? resolveFxNetworkOptions();
    const response = await smartNetworkGet<ArrayBuffer>(SINA_FX_URL, networkOptions, {
      responseType: "arraybuffer",
      timeout: 5000,
      headers: { Referer: "https://finance.sina.com.cn" },
    });
    const rates = parseSinaFxResponse(decodeGbk(response.data));
    if (!rates) {
      logger.warn("[fxRateService] 在线汇率报文解析失败，本次沿用既有汇率回退");
      return undefined;
    }
    return rates;
  } catch (err) {
    logger.warn("[fxRateService] 在线汇率拉取失败，本次沿用既有汇率回退", err);
    return undefined;
  }
}
