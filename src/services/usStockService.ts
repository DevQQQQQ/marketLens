// src/services/usStockService.ts
import type { MarketItem } from "../types";
import { logger } from "../utils/logger.ts";
import { normalizeUSCode } from "../utils/symbolHelper.ts";
import { TencentBaseService, MIN_TENCENT_FIELDS, parseOptionalFloat } from "./tencentBaseService.ts";

/**
 * 腾讯美股行情 API 字段索引
 * v_usAAPL="200~苹果~AAPL.OQ~185.92~185.00~186.00~...~涨跌额~涨跌幅%~最高~最低~成交量(股)~成交额(美元)..."
 */
const F = {
  NAME:        1,
  CODE:        2,
  PRICE:       3,
  PREV_CLOSE:  4,
  OPEN:        5,
  VOLUME_SHARES: 6,
  CHANGE_AMT:  31, // 涨跌额
  CHANGE_PCT:  32, // 涨跌幅 %
  HIGH:        33, // 今日最高
  LOW:         34, // 今日最低
  TURNOVER:    37, // 成交额 (美元)
} as const;

export class USStockService extends TencentBaseService {
  public readonly serviceName = "USStockService";
  public readonly currency = "USD" as const;
  public readonly assetType = "US_STOCK" as const;

  /**
   * 规范化美股代码，例如 "AAPL" -> "usAAPL", "usAAPL" -> "usAAPL", "us.IXIC" -> "usIXIC", ".IXIC" -> "usIXIC"
   */
  public normalizeCode(raw: string): string {
    return normalizeUSCode(raw);
  }

  public parseResponse(text: string): MarketItem[] {
    const items: MarketItem[] = [];

    for (const line of text.split(";").map((l) => l.trim()).filter(Boolean)) {
      const match = line.match(/^v_([a-zA-Z0-9._-]+)="(.+)"$/);
      if (!match) { continue; }

      const fullCode = match[1];
      const f = match[2].split("~");
      if (f.length < MIN_TENCENT_FIELDS) {
        logger.warn(
          `[USStockService] 标的 ${fullCode} 返回字段不足 (length=${f.length})，该代码可能不存在或已退市`
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
      const rawSymbol = f[F.CODE] || fullCode.replace(/^us[\._\-]?/i, "");
      const parts = rawSymbol.split(".").filter(Boolean);
      const symbol = (parts.length > 0 ? parts[0] : rawSymbol).toUpperCase();

      items.push({
        id:           fullCode,
        name:         f[F.NAME] || symbol,
        symbol:       symbol,
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
