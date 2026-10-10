// src/utils/inputValidator.ts
// 注意：此处必须显式携带 .ts 扩展名 —— 本模块处于 node:test 类型剥离运行时的加载链路上，
// 与 src/services/alertManager.ts 保持同一约定；esbuild 打包同样兼容该写法。
import { inferAShareExchange, isContractAddress } from "./symbolHelper.ts";
export { isContractAddress };

export interface ParsedItemInput {
  symbol: string;
  type: "A_SHARE" | "HK_STOCK" | "US_STOCK" | "CRYPTO" | "ALPHA_TOKEN";
  defaultGroup: string;
  hint: string;
  alternativeGroup?: string;
  alternativeType?: "A_SHARE" | "HK_STOCK" | "US_STOCK" | "CRYPTO" | "ALPHA_TOKEN";
}

/**
 * 从 DexScreener、Pump.fun、GeckoTerminal、Birdeye 等完整网页 URL 中自动提取合约/Mint 地址
 */
export function extractContractAddressFromUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  // 0. 明确排除交易/区块详情链接（如 etherscan.io/tx/... 或 solscan.io/tx/...），避免将 tx hash 误当合约截断提取
  if (/\/(?:tx|txs|block)\//i.test(trimmed)) {
    return null;
  }

  // 1. 优先提取 0x 开头的 42位 EVM 合约地址（BSC, ETH, Base, Arbitrum 等）
  // 严格要求右边界：40位 hex 之后绝不能紧跟十六进制字符（杜绝 64 位 tx hash 或 block hash 被截断）
  const evmMatch = trimmed.match(/(?:^|[^0-9a-zA-Z])(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])/);
  if (evmMatch) {
    return evmMatch[1];
  }
  // 2. 匹配常见 DEX/区块链浏览器中的 Solana Base58 地址 (32~44位)
  // 格式如 /solana/<address>, /coin/<address>, /pools/<address>, /token/<address>, /account/<address>
  const solanaMatch = trimmed.match(
    /(?:dexscreener\.com\/[^\/]+\/|pump\.fun\/(?:coin\/)?|geckoterminal\.com\/[^\/]+\/pools\/|birdeye\.so\/token\/|gmgn\.ai\/[^\/]+\/token\/|solscan\.io\/(?:token|account)\/)([1-9A-HJ-NP-Za-km-z]{32,44})/i
  );
  if (solanaMatch) {
    return solanaMatch[1];
  }
  // 3. 通用兜底：URL 路径末尾的 32~44 位 Base58 字符串
  const generalBase58 = trimmed.match(/[\/=]([1-9A-HJ-NP-Za-km-z]{32,44})(?:[\/?#]|$)/);
  if (generalBase58) {
    return generalBase58[1];
  }
  return null;
}

export function validateAndParseInput(input: string): { error?: string; parsed?: ParsedItemInput } {
  let trimmed = input.trim();
  if (!trimmed) {
    return { error: "代码不能为空" };
  }

  // 拦截用户误贴的链上交易哈希或交易详情链接，给予精准的指引提示
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed) || /^https?:\/\/.*?\/(?:tx|txs)\//i.test(trimmed)) {
    return { error: "检测到输入为链上交易详情 (Tx Hash)，请粘贴代币合约地址 (Token Contract) 或代币详情页链接" };
  }

  // 0. 若用户粘贴的是网页完整 URL，自动提取内部的代币合约地址
  const extractedFromUrl = extractContractAddressFromUrl(trimmed);
  if (extractedFromUrl) {
    trimmed = extractedFromUrl;
  }

  // 1. 链上 DEX / Alpha 合约地址 (EVM 0x... 42位, 或 Solana Mint 32~44位)
  if (isContractAddress(trimmed)) {
    return {
      parsed: {
        symbol: trimmed,
        type: "ALPHA_TOKEN",
        defaultGroup: "Alpha",
        hint: "链上 DEX / Alpha 合约",
      },
    };
  }

  // 2. 港股代码校验（支持 5 位纯数字如 00700，或 hk00700 / r_hk00700）
  const hkExplicitMatch = trimmed.match(/^(?:r_)?hk(\d{1,5})$/i);
  if (hkExplicitMatch && hkExplicitMatch[1]) {
    const code = hkExplicitMatch[1].padStart(5, "0");
    return {
      parsed: {
        symbol: `hk${code}`,
        type: "HK_STOCK",
        defaultGroup: "港股",
        hint: `港股代码 (hk${code})`,
      },
    };
  }
  if (/^\d{5}$/.test(trimmed)) {
    return {
      parsed: {
        symbol: `hk${trimmed}`,
        type: "HK_STOCK",
        defaultGroup: "港股",
        hint: `港股代码 (hk${trimmed})`,
      },
    };
  }

  // 3. A 股代码与场内基金/ETF校验 (支持 6 位数字，如 600519/510300，或带前缀 sh600519 / sz000001 / bj830001)
  const aShareMatch = trimmed.match(/^(sh|sz|bj)?(\d{6})$/i);
  if (aShareMatch) {
    const prefix = aShareMatch[1] ? aShareMatch[1].toLowerCase() : "";
    const code = aShareMatch[2];
    // 无显式前缀时，按代码段精确推断交易所（沪/深/北），与行情抓取端共用同一规则
    const fullSymbol = prefix ? `${prefix}${code}` : `${inferAShareExchange(code)}${code}`;

    // 智能识别场内基金/ETF/LOF代码段：
    // 沪市：50xxxx, 51xxxx, 56xxxx, 58xxxx (如 510300 沪深300ETF, 588000 科创50ETF)
    // 深市：15xxxx (ETF), 16xxxx (LOF) (如 159915 创业板ETF, 161725 白酒LOF)
    const isFund = /^(5[0168]\d{4}|1[56]\d{4})$/.test(code);

    return {
      parsed: {
        symbol: fullSymbol,
        type: "A_SHARE",
        defaultGroup: "A股",
        hint: isFund ? `场内基金/ETF (${fullSymbol})` : `A股代码 (${fullSymbol})`,
      },
    };
  }

  // 4. 美股指数（如 .IXIC, .DJI）
  if (trimmed.startsWith(".")) {
    const sym = trimmed.toUpperCase();
    return {
      parsed: {
        symbol: sym,
        type: "US_STOCK",
        defaultGroup: "美股",
        hint: `美股指数 (${sym})`,
      },
    };
  }

  // 美股显式前缀（如 us.AAPL, us_TSLA, us-AMD，以及带类股后缀的 us.BRK.B, us-BF.B）
  if (/^us[\._\-][a-zA-Z]+(?:[\._\-][a-zA-Z]+)?$/i.test(trimmed)) {
    const ticker = trimmed.replace(/^us[\._\-]/i, "").toUpperCase().replace(/[\-_/]/g, ".");
    const sym = `us${ticker}`;
    return {
      parsed: {
        symbol: sym,
        type: "US_STOCK",
        defaultGroup: "美股",
        hint: `美股资产 (${sym})`,
      },
    };
  }

  // 腾讯美股前缀格式（小写 us + 大写 ticker，如 usAAPL, usAMD, usNET, usTSM，以及带类股后缀的 usBRK.B）
  // 需排除用户误打的加密货币前缀（如 usUSDT, usUSDC, usBTCUSDT）
  if (/^us[A-Z]+(?:[\._\-][A-Z]+)?$/.test(trimmed) && !/^us(USDT|USDC|BUSD|FDUSD|BTC|ETH)/i.test(trimmed)) {
    const sym = trimmed.replace(/[\-_/]/g, ".");
    return {
      parsed: {
        symbol: sym,
        type: "US_STOCK",
        defaultGroup: "美股",
        hint: `美股资产 (${sym})`,
      },
    };
  }

  // 美股类股代码（Class A/B/C，如 BRK.B, BRK-B, BF.B, BRK.A, BF.A，标准点号统一规整）
  const usClassMatch = trimmed.match(/^([a-zA-Z]{1,5})[\.\-_/]([a-zA-Z]{1,2})$/);
  if (usClassMatch) {
    const sym = `${usClassMatch[1].toUpperCase()}.${usClassMatch[2].toUpperCase()}`;
    return {
      parsed: {
        symbol: sym,
        type: "US_STOCK",
        defaultGroup: "美股",
        hint: `美股代码 (${sym})`,
      },
    };
  }

  // 如果纯数字但不是 5/6 位，明确报错拦截
  if (/^\d+$/.test(trimmed)) {
    return {
      error: `⚠️ 纯数字仅支持 5位港股（如 00700）或 6位A股股票代码（如 600519），当前输入为 ${trimmed.length} 位数字`,
    };
  }

  // 5. 字母代码：支持加密币（如 BTCUSDT, USDCUSDT, USDTTRY, ETH, DOGE）或美股个股（如 AAPL, TSLA, NVDA）
  const cryptoMatch = trimmed.match(/^([a-zA-Z0-9]{1,10})([\/\-_]?([a-zA-Z0-9]{2,10}))?$/);
  if (cryptoMatch) {
    const cleanUpper = trimmed.toUpperCase().replace(/[\/\-_]/g, "");
    // 如果包含计价货币尾缀（如 USDT / USDC / BUSD / FDUSD / BTC / ETH），或以主流基础稳定币开头（如 USDCUSDT, USDTTRY, USDCTRY, USD1USDT），确定为加密货币
    const isCryptoQuote =
      cleanUpper.endsWith("USDT") ||
      cleanUpper.endsWith("USDC") ||
      cleanUpper.endsWith("BUSD") ||
      cleanUpper.endsWith("FDUSD");
    const isCryptoBase =
      cleanUpper.startsWith("USDT") ||
      cleanUpper.startsWith("USDC") ||
      cleanUpper.startsWith("USD1") ||
      cleanUpper.startsWith("FDUSD");

    if (isCryptoQuote || (isCryptoBase && cleanUpper.length >= 6)) {
      return {
        parsed: {
          symbol: cleanUpper,
          type: "CRYPTO",
          defaultGroup: "Binance",
          hint: `加密货币币对 (${cleanUpper})`,
        },
      };
    }

    // 如果是 1~5 位纯字母（如 AAPL, TSLA, NVDA），可能是美股也可以是单币
    const POPULAR_CRYPTO_TOKENS = new Set([
      "BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "AVAX", "DOT", "MATIC",
      "LINK", "UNI", "SHIB", "PEPE", "NEAR", "SUI", "APT", "TRX", "LTC", "BCH"
    ]);
    const isPopularCrypto = POPULAR_CRYPTO_TOKENS.has(cleanUpper);

    return {
      parsed: {
        symbol: cleanUpper,
        type: "US_STOCK",
        defaultGroup: "美股",
        hint: isPopularCrypto
          ? `常见加密货币 (${cleanUpper})，加入 Binance 将自动适配为 ${cleanUpper}USDT；亦可作为美股`
          : `美股代码 (${cleanUpper})，亦可作为加密币加入 Binance`,
        alternativeGroup: "Binance",
        alternativeType: "CRYPTO",
      },
    };
  }

  return {
    error: "⚠️ 格式不合法！请输入：A股(6位)、港股(5位)、美股代码(如 AAPL)、币对(如 BTCUSDT) 或 链上合约地址(0x...)",
  };
}
