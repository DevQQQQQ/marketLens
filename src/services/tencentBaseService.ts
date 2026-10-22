// src/services/tencentBaseService.ts
import type { MarketItem } from "../types";
import { smartNetworkGet } from "./network.ts";
import { logger } from "../utils/logger.ts";
import { chunkArray, decodeGbk } from "../utils/symbolHelper.ts";

/**
 * 腾讯报文「字段不足」守卫的最小字段数（三个腾讯服务共用的**单一真相源**）。
 *
 * 它同时是「守卫内下标」与「守卫外下标」的分界线：各服务 `F` 字段表里任何
 * **≥ 本值**的下标（A股的 37/38/39/43/44/45/46/47/48/49/51，港美股的 37），
 * 上游少发字段时取到的是 `undefined`，读取**必须**走 `parseOptionalFloat`，
 * 禁止 `parseFloat(...) || 0` 把「未供数」伪装成「数值为 0」（AGENTS.md §6.13）。
 * 三个服务原本各写一份内联字面量，正是这类脱节长期无人发现的原因。
 */
export const MIN_TENCENT_FIELDS = 35;

/**
 * 腾讯报文可选浮点字段的**唯一**解析出口（AGENTS.md §6.13）。
 *
 * 空串、`"-"`、`"-1"` 占位、非有限数值以及**下标越界拿到的 `undefined`** 一律返回 `undefined`。
 * 产品口径是「上游未供数」与「数值为 0」是两件事：用 `parseFloat(...) || 0` 兜底会让卡片把
 * 「没有这个字段」渲染成「该数值为 0」，且不抛错、不告警，属最难发现的一类静默失真。
 * 因此凡读取 `f.length < 35` 守卫**覆盖范围之外**的字段下标，必须走本函数，不得就地 `|| 0`。
 */
export function parseOptionalFloat(val: string | undefined): number | undefined {
  if (!val || val === "-" || val === "-1") {
    return undefined;
  }
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 腾讯行情通用基类 (TencentBaseService)
 * 统一承载腾讯股票/指数 API (qt.gtimg.cn) 的通用分批调度、GBK解码、网络容错与三角数学自洽自愈逻辑。
 * 各子类仅需提供板块特定的字段映射与代码归一化规则。
 */
export abstract class TencentBaseService {
  protected readonly CHUNK_SIZE = 40;

  public abstract readonly serviceName: string;
  public abstract readonly currency: NonNullable<MarketItem["currency"]>;
  public abstract readonly assetType: MarketItem["type"];

  /**
   * 规范化标的代码（如补足前缀、补前导0等）
   */
  public abstract normalizeCode(raw: string): string;

  /**
   * 解析上游返回的 GBK 报文文本
   */
  public abstract parseResponse(text: string): MarketItem[];

  /**
   * 批量抓取标的最新行情
   */
  public async fetchQuotes(
    codes: string[],
    options: { mode: "proxy" | "direct"; proxyUrl?: string } = { mode: "direct" }
  ): Promise<MarketItem[]> {
    if (!codes.length) {
      return [];
    }

    const normalizedCodes = codes.map((c) => this.normalizeCode(c));
    const chunks = chunkArray(normalizedCodes, this.CHUNK_SIZE);

    const chunkPromises = chunks.map((batch) => this.fetchBatch(batch, options));
    const results = await Promise.all(chunkPromises);
    return results.flat();
  }

  /**
   * 单批次网络拉取与解码
   */
  protected async fetchBatch(
    batch: string[],
    options: { mode: "proxy" | "direct"; proxyUrl?: string }
  ): Promise<MarketItem[]> {
    if (!batch.length) {
      return [];
    }
    const url = `https://qt.gtimg.cn/q=${batch.join(",")}`;

    try {
      const response = await smartNetworkGet<ArrayBuffer>(url, options, {
        responseType: "arraybuffer",
        timeout: 5000,
      });

      const text = decodeGbk(response.data);
      return this.parseResponse(text);
    } catch (err) {
      logger.error(`[${this.serviceName}] fetchBatch error:`, err);
      return [];
    }
  }

  /**
   * 三角数学自洽校验与容错自愈：
   * 防止上游字段插入位移或偶发空值导致静默错值 (现价 - 昨收 = 涨跌额)
   */
  protected selfHealChange(
    price: number,
    prevClose: number,
    changeAmt: number,
    changePct: number,
    fullCode: string
  ): { changeAmt: number; changePct: number } {
    if (price > 0 && prevClose > 0) {
      const expectedAmt = price - prevClose;
      const expectedPct = (expectedAmt / prevClose) * 100;
      const amtDiff = Math.abs(changeAmt - expectedAmt);
      const pctDiff = Math.abs(changePct - expectedPct);

      // 区分"真实 0 (平盘日)"与"字段缺失/NaN"：
      // 平盘时 changeAmt 与 changePct 均为 0 且 expectedAmt 也为 0，属于合法行情，不误入自愈分支
      const isAmtMissing = changeAmt === undefined || Number.isNaN(changeAmt) || !Number.isFinite(changeAmt);
      const isPctMissing = changePct === undefined || Number.isNaN(changePct) || !Number.isFinite(changePct);
      const isAmtDiscrepancy =
        amtDiff > 0.08 && (Math.abs(expectedAmt) > 0 ? amtDiff / Math.abs(expectedAmt) > 0.15 : amtDiff > 0.08);
      const isPctDiscrepancy = pctDiff > 1.5;

      const isAmtBroken = isAmtMissing || isAmtDiscrepancy;
      const isPctBroken = isPctMissing || isPctDiscrepancy;

      if (isAmtBroken || isPctBroken) {
        if (changeAmt !== 0 || changePct !== 0) {
          logger.warn(
            `[${this.serviceName}] 标的 ${fullCode} 字段疑似位移或数据不自洽 (现价:${price}, 昨收:${prevClose}, 报文涨跌额:${changeAmt}), 已自动使用价格自愈`
          );
        }
        return {
          changeAmt: Number(expectedAmt.toFixed(price < 1 ? 4 : 2)),
          changePct: Number(expectedPct.toFixed(2)),
        };
      }
    }
    return { changeAmt, changePct };
  }
}
