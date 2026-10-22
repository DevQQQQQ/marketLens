// src/services/hkStockService.ts
import type { MarketItem } from "../types";
import { logger } from "../utils/logger.ts";
import { TencentBaseService, MIN_TENCENT_FIELDS, parseOptionalFloat } from "./tencentBaseService.ts";

/**
 * 腾讯港股行情 API 字段索引
 * v_hk00700="100~腾讯控股~00700~378.200~376.000~377.000~...~涨跌额~涨跌幅%~最高~最低~成交量(股)~成交额(元)..."
 */
const F = {
  NAME:        1,
  CODE:        2,
  PRICE:       3,
  PREV_CLOSE:  4,
  OPEN:        5,
  VOLUME_SHARES: 6, // 港股成交量单位通常为股
  CHANGE_AMT:  31, // 涨跌额
  CHANGE_PCT:  32, // 涨跌幅 %
  HIGH:        33, // 今日最高
  LOW:         34, // 今日最低
  TURNOVER:    37, // 成交额 (元/港币)
} as const;

export class HKStockService extends TencentBaseService {
  public readonly serviceName = "HKStockService";
  public readonly currency = "HKD" as const;
  public readonly assetType = "HK_STOCK" as const;

  /**
   * 规范化港股代码，例如 "00700" -> "hk00700", "700" -> "hk00700", "hk00700" -> "hk00700", "hkHSI" -> "hkHSI", "hsi" -> "hkHSI"
   */
  public normalizeCode(raw: string): string {
    const clean = raw.trim().replace(/^r_/i, "");
    if (/^hk/i.test(clean)) {
      const rest = clean.slice(2);
      if (/^\d+$/.test(rest)) {
        return `hk${rest.padStart(5, "0")}`;
      }
      return `hk${rest.toUpperCase()}`;
    }
    if (/^\d+$/.test(clean) && clean.length <= 5) {
      return `hk${clean.padStart(5, "0")}`;
    }
    if (/^[a-zA-Z]+$/.test(clean)) {
      return `hk${clean.toUpperCase()}`;
    }
    return `hk${clean}`;
  }

  public parseResponse(text: string): MarketItem[] {
    const items: MarketItem[] = [];

    for (const line of text.split(";").map((l) => l.trim()).filter(Boolean)) {
      const match = line.match(/^v_([a-zA-Z0-9_\.]+)="(.+)"$/);
      if (!match) { continue; }

      const fullCode = match[1].replace(/^r_/i, "");
      const f = match[2].split("~");
      if (f.length < MIN_TENCENT_FIELDS) {
        logger.warn(
          `[HKStockService] 标的 ${fullCode} 返回字段不足 (length=${f.length})，该代码可能不存在或已退市`
        );
        continue;
      }

      const price     = parseFloat(f[F.PRICE])      || 0;
      const prevClose = parseFloat(f[F.PREV_CLOSE]) || 0;
      const open      = parseFloat(f[F.OPEN])       || 0;
      const high      = parseFloat(f[F.HIGH])       || 0;
      const low       = parseFloat(f[F.LOW])        || 0;
      const rawChangeAmt = parseFloat(f[F.CHANGE_AMT]) || 0;
      const rawChangePct = parseFloat(f[F.CHANGE_PCT]) || 0;

      const { changeAmt, changePct } = this.selfHealChange(price, prevClose, rawChangeAmt, rawChangePct, fullCode);

      const volume    = parseFloat(f[F.VOLUME_SHARES]) || 0;
      // ⚠ `F.TURNOVER` = 37 落在上方 `f.length < MIN_TENCENT_FIELDS` 守卫的覆盖范围之外，
      // 必须走可选解析出口，禁止用 `|| 0` 把「上游未供数」伪装成「成交额为 0」（§6.13）。
      const turnover  = parseOptionalFloat(f[F.TURNOVER]);

      items.push({
        id:           fullCode,
        name:         f[F.NAME] || f[F.CODE],
        symbol:       f[F.CODE] || fullCode.replace(/^hk/i, ""),
        type:         this.assetType,
        price,
        changePercent: changePct,
        open,
        prevClose,
        high,
        low,
        change:   changeAmt,
        volume,
        turnover,
        currency: this.currency,
      });
    }

    return items;
  }
}
