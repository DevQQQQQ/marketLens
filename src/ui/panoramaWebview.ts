// src/ui/panoramaWebview.ts
// 市场全景行情中心 WebviewPanel 单例控制器。
// 按需懒加载，关闭即销毁定时器，保证 0 后台资源常驻开销。

import * as vscode from "vscode";
import * as crypto from "crypto";
import { getPanoramaHtml } from "./panoramaHtml.ts";
import { computeSquarifiedTreemap } from "../utils/treemap.ts";
import { renderDistributionSvg, renderFearGreedGaugeSvg } from "../utils/panoramaSvg.ts";
import {
  fetchASharePanorama,
  fetchCryptoPanorama,
  fetchGlobalPanorama,
  fetchHkPanorama,
  fetchUsPanorama,
  fetchFundPanorama,
} from "../services/panoramaService.ts";
import { logger } from "../utils/logger.ts";

// 与 panoramaHtml.ts 的 data-tab 集合一致；Webview 消息按不可信输入处理
const PANORAMA_TABS: ReadonlySet<string> = new Set(["ashare", "crypto", "global", "hk", "us", "fund"]);

export class MarketPanoramaWebviewPanel {
  public static currentPanel: MarketPanoramaWebviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _activeTab: string = "ashare";
  private _pollTimer: NodeJS.Timeout | undefined;
  private _isDisposed: boolean = false;
  private _containerWidth: number = 600;
  private _fullWidth: number = 1000;
  private _containerHeight: number = 420;
  private readonly _tabRefreshSeq = new Map<string, number>();

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    if (MarketPanoramaWebviewPanel.currentPanel) {
      MarketPanoramaWebviewPanel.currentPanel._panel.reveal(column);
      void MarketPanoramaWebviewPanel.currentPanel.refreshCurrentTab();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "marketlensPanorama",
      "⚡ MarketLens 行情中心",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    MarketPanoramaWebviewPanel.currentPanel = new MarketPanoramaWebviewPanel(panel, extensionUri);
  }

  /**
   * 老板键或扩展退出时主动关闭行情中心面板
   */
  public static closeIfVisible(): void {
    if (MarketPanoramaWebviewPanel.currentPanel) {
      MarketPanoramaWebviewPanel.currentPanel.dispose();
    }
  }

  private constructor(panel: vscode.WebviewPanel, _extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    const nonce = crypto.randomBytes(16).toString("base64");
    const cspSource = this._panel.webview.cspSource;
    this._panel.webview.html = getPanoramaHtml({ nonce, cspSource });

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        if (!message || typeof message !== "object") return;
        switch (message.command) {
          case "ready":
            void this.refreshCurrentTab();
            this.setupPolling();
            break;
          case "switchTab":
            if (typeof message.tab === "string" && PANORAMA_TABS.has(message.tab)) {
              this._activeTab = message.tab;
              void this.refreshCurrentTab();
              this.setupPolling();
            }
            break;
          case "refresh":
            void this.refreshCurrentTab();
            break;
          case "resize":
            if (typeof message.width === "number" && Number.isFinite(message.width) && message.width > 200) {
              this._containerWidth = Math.max(300, message.width * 0.5);
              this._fullWidth = Math.max(400, message.width - 80);
            }
            void this.refreshCurrentTab();
            break;
        }
      },
      null,
      this._disposables
    );

    // retainContextWhenHidden 只保留 DOM，不会停掉后端定时器；
    // 面板切到后台/被遮挡时停止轮询，回到前台立即刷新一次并恢复轮询
    this._panel.onDidChangeViewState(
      () => {
        if (this._isDisposed) return;
        if (this._panel.visible) {
          void this.refreshCurrentTab();
          this.setupPolling();
        } else if (this._pollTimer) {
          clearInterval(this._pollTimer);
          this._pollTimer = undefined;
        }
      },
      null,
      this._disposables
    );
  }

  private setupPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = undefined;
    }
    if (this._isDisposed || !this._panel.visible) return;

    // A 股 20 秒轮询，加密 15 秒轮询，非活动页面不轮询
    const interval = this._activeTab === "crypto" ? 15_000 : 20_000;
    this._pollTimer = setInterval(() => {
      void this.refreshCurrentTab();
    }, interval);
  }

  public async refreshCurrentTab(): Promise<void> {
    if (this._isDisposed) return;

    const tab = this._activeTab;
    const seq = (this._tabRefreshSeq.get(tab) ?? 0) + 1;
    this._tabRefreshSeq.set(tab, seq);
    const isStale = () => this._isDisposed || this._tabRefreshSeq.get(tab) !== seq;

    try {
      if (tab === "ashare") {
        const raw = await fetchASharePanorama();
        if (isStale()) return;

        // 计算 SVG 直方图与 Treemap 几何布局
        const distributionSvg = renderDistributionSvg(raw.distribution, 310, 160);
        const sectorRects = computeSquarifiedTreemap(raw.sectors, this._containerWidth, this._containerHeight);

        this._panel.webview.postMessage({
          type: "ashare",
          data: {
            distribution: raw.distribution,
            distributionSvg,
            sectors: sectorRects,
            topInflows: raw.topInflows,
            topOutflows: raw.topOutflows,
          },
        });
      } else if (tab === "crypto") {
        const raw = await fetchCryptoPanorama();
        if (isStale()) return;

        const fearGreedSvg = renderFearGreedGaugeSvg(raw.fearGreed, 240, 140);
        const cryptoRects = computeSquarifiedTreemap(raw.heatmap, this._containerWidth, this._containerHeight);

        this._panel.webview.postMessage({
          type: "crypto",
          data: {
            fearGreed: raw.fearGreed,
            fearGreedSvg,
            heatmap: cryptoRects,
            topGainers: raw.topGainers,
            topLosers: raw.topLosers,
          },
        });
      } else if (tab === "global") {
        const raw = await fetchGlobalPanorama();
        if (isStale()) return;

        this._panel.webview.postMessage({
          type: "global",
          data: {
            indices: raw.indices,
            commodities: raw.commodities,
          },
        });
      } else if (tab === "hk") {
        const raw = await fetchHkPanorama();
        if (isStale()) return;

        const leaderRects = computeSquarifiedTreemap(raw.leaders, this._fullWidth, this._containerHeight);
        this._panel.webview.postMessage({
          type: "hk",
          data: {
            indices: raw.indices,
            leaders: leaderRects,
          },
        });
      } else if (tab === "us") {
        const raw = await fetchUsPanorama();
        if (isStale()) return;

        const mag7Rects = computeSquarifiedTreemap(raw.mag7, this._fullWidth, this._containerHeight);
        this._panel.webview.postMessage({
          type: "us",
          data: {
            indices: raw.indices,
            mag7: mag7Rects,
          },
        });
      } else if (tab === "fund") {
        const raw = await fetchFundPanorama();
        if (isStale()) return;

        const etfRects = computeSquarifiedTreemap(raw.popularEtfs, this._fullWidth, this._containerHeight);
        this._panel.webview.postMessage({
          type: "fund",
          data: {
            popularEtfs: etfRects,
          },
        });
      }
    } catch (err) {
      logger.warn(`[MarketPanorama] 刷新 ${tab} 数据失败: ${String((err as Error)?.message || err)}`);
    }
  }

  public dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    MarketPanoramaWebviewPanel.currentPanel = undefined;

    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = undefined;
    }

    try {
      this._panel.dispose();
    } catch {
      // 避免重复销毁报错
    }

    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
