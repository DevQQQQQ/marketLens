// src/services/aShareService.ts
import type { MarketItem } from "../types";
import { logger } from "../utils/logger.ts";
import { normalizeAShareCode } from "../utils/symbolHelper.ts";
import { TencentBaseService, MIN_TENCENT_FIELDS, parseOptionalFloat } from "./tencentBaseService.ts";

/**
 * 腾讯行情 API 字段索引（经验证）
 * v_sh600519="1~名称~代码~现价~昨收~今开~成交量(手)~外盘~内盘~...~涨跌额~涨跌幅%~最高~最低~成交额(元)~..."
 */
const F = {
  NAME:         1,
  CODE:         2,
  PRICE:        3,
  PREV_CLOSE:   4,
  OPEN:         5,
  VOLUME_LOTS:  6,   // 成交量（手），1手=100股
  CHANGE_AMT:   31,  // 涨跌额
  CHANGE_PCT:   32,  // 涨跌幅 %
  HIGH:         33,  // 今日最高
  LOW:          34,  // 今日最低
  TURNOVER:     37,  // 成交额（万元）
  TURNOVER_RATE: 38, // 换手率 %
  PE_TTM:       39,  // 市盈率 (TTM)
  AMPLITUDE:    43,  // 振幅 %
  CIRC_MV:      44,  // 流通市值（亿元）
  TOTAL_MV:     45,  // 总市值（亿元）
  PB:           46,  // 市净率
  LIMIT_UP:     47,  // 涨停价
  LIMIT_DOWN:   48,  // 跌停价
  VOLUME_RATIO: 49,  // 量比
  AVG_PRICE:    51,  // 日内均价
} as const;

export class AShareService extends TencentBaseService {
  public readonly serviceName = "AShareService";
  public readonly currency = "CNY" as const;
  public readonly assetType = "A_SHARE" as const;

  public normalizeCode(raw: string): string {
    // 统一复用 symbolHelper 的交易所推断规则，确保与输入解析端（inputValidator）绝对一致
    return normalizeAShareCode(raw);
  }

  public parseResponse(text: string): MarketItem[] {
    const items: MarketItem[] = [];

    for (const line of text.split(";").map((l) => l.trim()).filter(Boolean)) {
      const match = line.match(/^v_([a-zA-Z0-9]+)="(.+)"$/);
      if (!match) { continue; }

      const fullCode = match[1];
      const f = match[2].split("~");
      if (f.length < MIN_TENCENT_FIELDS) {
        logger.warn(
          `[AShareService] 标的 ${fullCode} 返回字段不足 (length=${f.length})，该代码可能不存在或已退市`
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

      // 成交量：腾讯接口 A 股单位为“手”，转换为“股”
      const volume    = (parseFloat(f[F.VOLUME_LOTS]) || 0) * 100;
      // 成交额：腾讯接口 A 股单位为“万元”，转换为“元”。
      // ⚠ `F.TURNOVER` = 37 落在上方 `f.length < MIN_TENCENT_FIELDS` 守卫的覆盖范围之外，
      // 必须走可选解析出口，禁止用 `|| 0` 把「上游未供数」伪装成「成交额为 0」（§6.13）。
      const rawTurnover = parseOptionalFloat(f[F.TURNOVER]);
      const turnover  = rawTurnover === undefined ? undefined : rawTurnover * 10000;

      // ── 深度量价与估值指标解析（具备防越界与无效数据防御） ──
      const turnoverRate = parseOptionalFloat(f[F.TURNOVER_RATE]);
      const peTtm        = parseOptionalFloat(f[F.PE_TTM]);
      const amplitude    = parseOptionalFloat(f[F.AMPLITUDE]);

      const rawCircMv    = parseOptionalFloat(f[F.CIRC_MV]);
      // 腾讯返回单位为亿元，转换为基准货币“元”
      const circulationMarketValue = (rawCircMv !== undefined && rawCircMv > 0) ? rawCircMv * 1e8 : undefined;

      const rawTotalMv   = parseOptionalFloat(f[F.TOTAL_MV]);
      const totalMarketValue = (rawTotalMv !== undefined && rawTotalMv > 0) ? rawTotalMv * 1e8 : undefined;

      const rawPb        = parseOptionalFloat(f[F.PB]);
      // 指数无 PB 或返回 0.00 时过滤
      const pb           = (rawPb !== undefined && rawPb > 0) ? rawPb : undefined;

      const rawLimitUp   = parseOptionalFloat(f[F.LIMIT_UP]);
      const limitUp      = (rawLimitUp !== undefined && rawLimitUp > 0) ? rawLimitUp : undefined;

      const rawLimitDown = parseOptionalFloat(f[F.LIMIT_DOWN]);
      const limitDown    = (rawLimitDown !== undefined && rawLimitDown > 0) ? rawLimitDown : undefined;

      const volumeRatio  = parseOptionalFloat(f[F.VOLUME_RATIO]);

      const rawAvgPrice  = parseOptionalFloat(f[F.AVG_PRICE]);
      const avgPrice     = (rawAvgPrice !== undefined && rawAvgPrice > 0) ? rawAvgPrice : undefined;

      items.push({
        id:           fullCode,
        name:         f[F.NAME] || f[F.CODE],
        symbol:       f[F.CODE],
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
        turnoverRate,
        peTtm,
        pb,
        amplitude,
        circulationMarketValue,
        totalMarketValue,
        limitUp,
        limitDown,
        volumeRatio,
        avgPrice,
      });
    }

    return items;
  }
}