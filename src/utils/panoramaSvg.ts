// src/utils/panoramaSvg.ts
// 纯原生 SVG 渲染工具：负责直方图（涨跌分布）、比例条与情绪仪表盘。
// 0 外部图表库依赖，体积轻量（< 2KB），支持自适应色彩与深浅主题。

export interface MarketDistributionBins {
  readonly upLimit: number; // 涨停
  readonly upHigh: number; // >5%
  readonly upMid: number; // 2%~5%
  readonly upLow: number; // 0%~2%
  readonly flat: number; // 平盘
  readonly downLow: number; // 0%~-2%
  readonly downMid: number; // -2%~-5%
  readonly downHigh: number; // <-5%
  readonly downLimit: number; // 跌停
  readonly upTotal: number; // 上涨合计
  readonly downTotal: number; // 下跌合计
  readonly turnover?: string; // 成交额格式化文本（如 "1.06万亿"）
}

export interface FearGreedData {
  readonly score: number; // 0 ~ 100
  readonly classification: string; // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  readonly timestamp?: number | undefined;
  readonly previousClose?: number | undefined;
  readonly oneWeekAgo?: number | undefined;
  readonly oneMonthAgo?: number | undefined;
}

/**
 * 生成 A 股涨跌分布梯队直方图与比例条 SVG
 */
export function renderDistributionSvg(data: MarketDistributionBins, width: number = 360, height: number = 180): string {
  const bins = [
    { label: "涨停", count: data.upLimit, color: "#eb445a" },
    { label: "&gt;5%", count: data.upHigh, color: "#eb445a" },
    { label: "2~5%", count: data.upMid, color: "#eb445a" },
    { label: "0~2%", count: data.upLow, color: "#eb445a" },
    { label: "平", count: data.flat, color: "#8a919e" },
    { label: "0~-2%", count: data.downLow, color: "#2dd36f" },
    { label: "-2~-5%", count: data.downMid, color: "#2dd36f" },
    { label: "&lt;-5%", count: data.downHigh, color: "#2dd36f" },
    { label: "跌停", count: data.downLimit, color: "#2dd36f" },
  ];

  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const chartHeight = 110;
  const barWidth = 26;
  const gap = (width - 20 - barWidth * bins.length) / (bins.length - 1);

  let barsSvg = "";
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i]!;
    const barH = Math.max(Math.round((b.count / maxCount) * (chartHeight - 30)), b.count > 0 ? 3 : 1);
    const x = 10 + i * (barWidth + gap);
    const y = chartHeight - barH;

    barsSvg += `
      <g class="bar-group">
        <text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" font-size="10" fill="var(--vscode-foreground, #ccc)">${b.count}</text>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="2" fill="${b.color}" opacity="0.9" />
        <text x="${x + barWidth / 2}" y="${chartHeight + 14}" text-anchor="middle" font-size="9" fill="var(--vscode-descriptionForeground, #888)">${b.label}</text>
      </g>
    `;
  }

  // 底部比例条计算
  const total = (data.upTotal || 0) + (data.downTotal || 0) + (data.flat || 0);
  const upPct = total > 0 ? (data.upTotal / total) * 100 : 50;
  const flatPct = total > 0 ? (data.flat / total) * 100 : 0;
  const downPct = total > 0 ? (data.downTotal / total) * 100 : 50;

  const barY = height - 25;
  const barW = width - 20;

  const upW = Math.max(1, (upPct / 100) * barW);
  const flatW = (flatPct / 100) * barW;
  const downW = Math.max(1, (downPct / 100) * barW);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      ${barsSvg}
      <!-- 底部比例分布条 -->
      <g transform="translate(10, ${barY})">
        <rect x="0" y="0" width="${upW}" height="7" rx="3" fill="#eb445a" />
        ${flatW > 0 ? `<rect x="${upW + 2}" y="0" width="${Math.max(1, flatW - 4)}" height="7" rx="1" fill="#8a919e" />` : ""}
        <rect x="${upW + flatW}" y="0" width="${downW}" height="7" rx="3" fill="#2dd36f" />
      </g>
      <text x="10" y="${height - 4}" font-size="11" font-weight="600" fill="#eb445a">上涨 ${data.upTotal} 只</text>
      <text x="${width - 10}" y="${height - 4}" text-anchor="end" font-size="11" font-weight="600" fill="#2dd36f">${data.downTotal} 只 下跌</text>
    </svg>
  `.trim();
}

/**
 * 映射恐慌贪婪分级到中文与颜色
 */
export function getFearGreedMeta(score: number): { labelZh: string; labelEn: string; color: string } {
  if (score <= 25) {
    return { labelZh: "极度恐慌", labelEn: "Extreme Fear", color: "#eb445a" };
  } else if (score <= 45) {
    return { labelZh: "恐慌", labelEn: "Fear", color: "#ff8c00" };
  } else if (score <= 55) {
    return { labelZh: "中立", labelEn: "Neutral", color: "#e0ac00" };
  } else if (score <= 75) {
    return { labelZh: "贪婪", labelEn: "Greed", color: "#2dd36f" };
  } else {
    return { labelZh: "极度贪婪", labelEn: "Extreme Greed", color: "#10dc60" };
  }
}

/**
 * 生成类似 CoinMarketCap 的恐慌贪婪半圆仪表盘 SVG
 */
export function renderFearGreedGaugeSvg(data: FearGreedData, width: number = 240, height: number = 150): string {
  const score = Math.min(100, Math.max(0, data.score));
  const meta = getFearGreedMeta(score);

  // 180度半圆弧，从 -180° 到 0° (在 SVG 坐标系中从 180° 到 360°)
  const cx = width / 2;
  const cy = height - 25;
  const r = Math.min(cx - 25, cy - 20);

  // 指针角度：0 分对应 -180°，100 分对应 0°
  const angleDeg = -180 + (score / 100) * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  const needleLen = r - 12;
  const nx = cx + needleLen * Math.cos(angleRad);
  const ny = cy + needleLen * Math.sin(angleRad);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#eb445a" />
          <stop offset="25%" stop-color="#ff8c00" />
          <stop offset="50%" stop-color="#e0ac00" />
          <stop offset="75%" stop-color="#2dd36f" />
          <stop offset="100%" stop-color="#10dc60" />
        </linearGradient>
      </defs>
      <!-- 刻度底弧 -->
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="url(#gaugeGrad)" stroke-width="12" stroke-linecap="round" />
      <!-- 指针 -->
      <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${meta.color}" stroke-width="3" stroke-linecap="round" />
      <circle cx="${cx}" cy="${cy}" r="5" fill="${meta.color}" />
      <!-- 读数与分级 -->
      <text x="${cx}" y="${cy - 20}" text-anchor="middle" font-size="28" font-weight="bold" fill="${meta.color}">${score}</text>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="13" font-weight="600" fill="var(--vscode-foreground, #ccc)">${meta.labelZh} (${meta.labelEn})</text>
    </svg>
  `.trim();
}
