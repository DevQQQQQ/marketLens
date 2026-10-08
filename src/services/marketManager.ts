// src/services/marketManager.ts
import type { MarketItem } from "../types/index.ts";
import { AShareService } from "./aShareService.ts";
import { HKStockService } from "./hkStockService.ts";
import { USStockService } from "./usStockService.ts";
import { BinanceService } from "./binanceService.ts";
import { DexScreenerService } from "./dexScreenerService.ts";
import { DEFAULT_PROXY_URL, type CryptoNetworkOptions } from "./network.ts";
import { logger } from "../utils/logger.ts";

export interface PollTargets {
  funds?: string[];
  aShares?: string[];
  hkStocks?: string[];
  usStocks?: string[];
  cryptos?: string[];
  bscTokens?: string[];
}

export class MarketManager {
  private aShareService: AShareService;
  private hkStockService: HKStockService;
  private usStockService: USStockService;
  private binanceService: BinanceService;
  private dexScreenerService: DexScreenerService;

  constructor() {
    this.aShareService = new AShareService();
    this.hkStockService = new HKStockService();
    this.usStockService = new USStockService();
    this.binanceService = new BinanceService();
    this.dexScreenerService = new DexScreenerService();
  }

  public clearInvalidCache(): void {
    this.binanceService.clearInvalidCache();
    this.dexScreenerService.clearInvalidCache();
  }

  public clearBinanceInvalidCache(): void {
    this.clearInvalidCache();
  }

  /**
   * 统一调度方法：并行抓取 基金、A股、港股、美股、主流加密货币、Alpha 链上代币六类资产并聚合输出
   */
  async pollAll(
    targets: PollTargets,
    aShareOptions: CryptoNetworkOptions = { mode: "direct" },
    hkStockOptions: CryptoNetworkOptions = { mode: "direct" },
    usStockOptions: CryptoNetworkOptions = { mode: "direct" },
    binanceOptions: CryptoNetworkOptions = { mode: "proxy", proxyUrl: DEFAULT_PROXY_URL },
    alphaOptions: CryptoNetworkOptions = { mode: "proxy", proxyUrl: DEFAULT_PROXY_URL },
    fundOptions: CryptoNetworkOptions = { mode: "direct" }
  ): Promise<MarketItem[]> {
    const { funds = [], aShares = [], hkStocks = [], usStocks = [], cryptos = [], bscTokens = [] } = targets;

    const [fundRes, aShareRes, hkRes, usRes, cryptoRes, bscRes] = await Promise.allSettled([
      funds.length ? this.aShareService.fetchQuotes(funds, fundOptions) : Promise.resolve([]),
      aShares.length ? this.aShareService.fetchQuotes(aShares, aShareOptions) : Promise.resolve([]),
      hkStocks.length ? this.hkStockService.fetchQuotes(hkStocks, hkStockOptions) : Promise.resolve([]),
      usStocks.length ? this.usStockService.fetchQuotes(usStocks, usStockOptions) : Promise.resolve([]),
      cryptos.length ? this.binanceService.fetchQuotes(cryptos, binanceOptions) : Promise.resolve([]),
      bscTokens.length ? this.dexScreenerService.fetchQuotes(bscTokens, alphaOptions) : Promise.resolve([]),
    ]);

    const aggregated: MarketItem[] = [];

    if (fundRes.status === "fulfilled") {
      aggregated.push(...fundRes.value);
    } else {
      logger.error("[MarketManager] Fund fetch failed:", fundRes.reason);
    }

    if (aShareRes.status === "fulfilled") {
      aggregated.push(...aShareRes.value);
    } else {
      logger.error("[MarketManager] AShare fetch failed:", aShareRes.reason);
    }

    if (hkRes.status === "fulfilled") {
      aggregated.push(...hkRes.value);
    } else {
      logger.error("[MarketManager] HKStock fetch failed:", hkRes.reason);
    }

    if (usRes.status === "fulfilled") {
      aggregated.push(...usRes.value);
    } else {
      logger.error("[MarketManager] USStock fetch failed:", usRes.reason);
    }

    if (cryptoRes.status === "fulfilled") {
      aggregated.push(...cryptoRes.value);
    } else {
      logger.error("[MarketManager] Crypto fetch failed:", cryptoRes.reason);
    }

    if (bscRes.status === "fulfilled") {
      aggregated.push(...bscRes.value);
    } else {
      logger.error("[MarketManager] Alpha token fetch failed:", bscRes.reason);
    }

    return aggregated;
  }
}