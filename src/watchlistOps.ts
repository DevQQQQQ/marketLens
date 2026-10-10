import * as vscode from "vscode";
import { StockItem, WatchlistProvider } from "./ui/watchlistProvider.ts";
import type { MarketItem, PriceAlertItem } from "./types/index.ts";
import { isSameSymbol, normalizeSymbolKey, resolveItemDisplayName, batchReorderWatchlist, type ReorderItemDescriptor } from "./utils/symbolHelper.ts";
import { validateAndParseInput } from "./utils/inputValidator.ts";
import { readConfig } from "./utils/config.ts";
import { SettingsWebviewPanel } from "./ui/settingsWebview.ts";

export interface WatchlistOpsContext {
  quoteCache: Map<string, MarketItem>;
  rebuildTree: (customWatchlist?: Record<string, any[]>) => void;
  treeProvider?: WatchlistProvider;
}

export class WatchlistOps {
  private readonly quoteCache: Map<string, MarketItem>;
  private readonly rebuildTree: (customWatchlist?: Record<string, any[]>) => void;
  private readonly treeProvider?: WatchlistProvider;

  constructor(context: WatchlistOpsContext) {
    this.quoteCache = context.quoteCache;
    this.rebuildTree = context.rebuildTree;
    this.treeProvider = context.treeProvider;
  }

  /**
   * 批量处理自选标的拖拽重排（原子化单次磁盘写入）
   */
  public async handleBatchReorder(
    itemsToMove: ReorderItemDescriptor[],
    targetGroup: string,
    targetSymbol?: string
  ): Promise<void> {
    if (!itemsToMove || itemsToMove.length === 0) {
      return;
    }

    const cfg = readConfig();
    const newWatchlist = batchReorderWatchlist(
      cfg.watchlist,
      itemsToMove,
      targetGroup,
      targetSymbol
    );

    if (!newWatchlist) {
      return;
    }

    try {
      await vscode.workspace
        .getConfiguration("marketlens")
        .update("watchlist", newWatchlist, vscode.ConfigurationTarget.Global);

      this.rebuildTree(newWatchlist);
      SettingsWebviewPanel.syncSettings();
    } catch (err: any) {
      vscode.window.showErrorMessage(`调整标的顺序失败: ${err?.message || err}`);
    }
  }

  /**
   * 添加自选（带实时严格校验）
   */
  public async addItem(): Promise<void> {
    // ── Step 1: 获取用户输入并实时校验 ────────────────────────────
    const input = await vscode.window.showInputBox({
      prompt: "输入股票代码 / 币对 / 合约地址",
      placeHolder: "如：600519 / BTCUSDT / 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      validateInput: (v) => {
        const res = validateAndParseInput(v);
        return res.error ? res.error : undefined;
      },
    });
    if (!input) { return; }

    const validation = validateAndParseInput(input);
    if (validation.error || !validation.parsed) {
      vscode.window.showErrorMessage(validation.error || "输入格式不合法");
      return;
    }
    const detected = validation.parsed;
    const sym = detected.symbol;

    // ── Step 2: 读取当前 watchlist，让用户选择目标分组 ───────────
    const watchlist: Record<string, any[]> =
      vscode.workspace.getConfiguration("marketlens").get("watchlist", {});

    const existingGroups = Object.keys(watchlist);
    const sortedGroups = [
      detected.defaultGroup,
      ...existingGroups.filter((g) => g !== detected.defaultGroup),
      "➕ 新建分组…",
    ];

    const pickedGroup = await vscode.window.showQuickPick(sortedGroups, {
      title: `添加 "${sym}" (${detected.hint}) 到哪个分组？`,
      placeHolder: `自动识别：${detected.defaultGroup}（按 Enter 确认）`,
    });
    if (!pickedGroup) { return; }

    let targetGroup = pickedGroup;
    if (pickedGroup === "➕ 新建分组…") {
      const newGroup = await vscode.window.showInputBox({
        prompt: "输入新分组名称",
        placeHolder: "如：海外股票",
        validateInput: (v) => v.trim() ? undefined : "不能为空",
      });
      if (!newGroup) { return; }
      targetGroup = newGroup.trim();
    }

    // ── Step 3: 检查是否已存在（去重）───────────────────────────
    const groupItems: any[] = watchlist[targetGroup] ?? [];
    const alreadyExists = groupItems.some(
      (item) => isSameSymbol(item?.symbol, sym) || item?.symbol?.toLowerCase() === sym.toLowerCase()
    );
    if (alreadyExists) {
      vscode.window.showWarningMessage(
        `MarketLens: "${sym}" 已在分组 "${targetGroup}" 中`
      );
      return;
    }

    // ── Step 3.5: 可选输入友好显示名称（如：特斯拉、比特币） ───────
    const customNameInput = await vscode.window.showInputBox({
      title: `为 "${sym}" 设置显示名称（可选）`,
      prompt: "直接按 Enter 默认使用标的代码作为显示名称",
      placeHolder: `如：${detected.type === "US_STOCK" && sym.toUpperCase() === "TSLA" ? "特斯拉" : sym}`,
    });
    if (customNameInput === undefined) {
      return; // 用户按下 Esc 取消
    }
    const finalName = customNameInput.trim() || sym;

    // ── Step 4: 写入 settings.json ───────────────────────────────
    let finalType = detected.type;
    let symToSave = sym;
    if (detected.alternativeType) {
      if (detected.alternativeGroup && targetGroup.toLowerCase().includes(detected.alternativeGroup.toLowerCase())) {
        finalType = detected.alternativeType;
        if (finalType === "CRYPTO" && !/(USDT|USDC|FDUSD|BUSD|BTC|ETH)$/i.test(symToSave)) {
          symToSave = `${symToSave.toUpperCase()}USDT`;
        }
      } else if (targetGroup.includes("港股") || /\bhk\b/i.test(targetGroup)) {
        finalType = "HK_STOCK";
      } else if (targetGroup.includes("美股") || /\bus\b/i.test(targetGroup)) {
        finalType = "US_STOCK";
      }
    }

    const updated = {
      ...watchlist,
      [targetGroup]: [
        ...groupItems,
        { symbol: symToSave, name: finalName, type: finalType },
      ],
    };

    try {
      await vscode.workspace
        .getConfiguration("marketlens")
        .update("watchlist", updated, vscode.ConfigurationTarget.Global);

      // 主动重建树视图，与 pinToTop / removeItem / handleReorder 行为保持一致
      this.rebuildTree(updated);
      SettingsWebviewPanel.syncSettings();

      const displayDesc = finalName !== sym ? `${finalName} (${sym})` : sym;
      vscode.window.setStatusBarMessage(
        `$(check) 已添加 "${displayDesc}" 到 ${targetGroup}`,
        3000
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `无法写入用户设置：${err?.message || err}。请检查 VS Code 的 settings.json 文件是否包含语法错误。`
      );
    }
  }

  /**
   * 置顶标的（点击图钉图标或命令触发）
   */
  public async pinToTop(node?: StockItem): Promise<void> {
    const cfg = readConfig();
    const watchlist = { ...cfg.watchlist };

    let targetSymbol: string | undefined;
    let targetGroup: string | undefined;
    let targetName: string | undefined;

    if (node) {
      targetSymbol = node.confSymbol || node.item?.symbol || node.item?.id;
      targetGroup  = node.groupName;
      targetName   = node.item?.name || targetSymbol;
    } else {
      const allItems: { label: string; description: string; group: string; symbol: string }[] = [];
      for (const [grp, items] of Object.entries(watchlist)) {
        for (const it of items ?? []) {
          if (!it?.symbol) continue;
          allItems.push({
            label: it.name || it.symbol,
            description: `分组: ${grp} · 代码: ${it.symbol}`,
            group: grp,
            symbol: it.symbol,
          });
        }
      }

      if (allItems.length === 0) {
        vscode.window.showInformationMessage("MarketLens: 当前自选列表为空");
        return;
      }

      const picked = await vscode.window.showQuickPick(allItems, {
        title: "选择要置顶的标的",
        placeHolder: "搜索股票、币对或合约地址",
      });
      if (!picked) { return; }
      targetSymbol = picked.symbol;
      targetGroup  = picked.group;
      targetName   = picked.label;
    }

    if (!targetSymbol) { return; }

    if (!targetGroup) {
      for (const [grp, items] of Object.entries(watchlist)) {
        if (items?.some((it) => isSameSymbol(it?.symbol, targetSymbol))) {
          targetGroup = grp;
          break;
        }
      }
    }

    if (!targetGroup || !watchlist[targetGroup]) { return; }

    const items = [...watchlist[targetGroup]];
    const index = items.findIndex(
      (it) =>
        isSameSymbol(it?.symbol, targetSymbol) ||
        it?.symbol?.toLowerCase() === targetSymbol!.toLowerCase() ||
        (node?.item?.id && isSameSymbol(it?.symbol, node.item.id)) ||
        (node?.item?.symbol && isSameSymbol(it?.symbol, node.item.symbol))
    );

    if (index === -1) {
      return;
    }
    if (index === 0) {
      vscode.window.setStatusBarMessage(`$(info) "${targetName || targetSymbol}" 已在最顶部`, 2500);
      return;
    }

    const [pinnedItem] = items.splice(index, 1);
    items.unshift(pinnedItem);
    watchlist[targetGroup] = items;

    try {
      await vscode.workspace
        .getConfiguration("marketlens")
        .update("watchlist", watchlist, vscode.ConfigurationTarget.Global);

      this.rebuildTree(watchlist);
      SettingsWebviewPanel.syncSettings();

      vscode.window.setStatusBarMessage(`$(pin) 已将 "${targetName || targetSymbol}" 置顶`, 3000);
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `无法更新设置：${err?.message || err}。请检查 VS Code 的 settings.json 文件是否包含语法错误。`
      );
    }
  }

  /**
   * 删除自选（点击垃圾桶图标或命令触发）
   */
  public async removeItem(node?: StockItem): Promise<void> {
    const cfg = readConfig();
    const watchlist = { ...cfg.watchlist };

    let targetSymbol: string | undefined;
    let targetGroup: string | undefined;
    let targetName: string | undefined;

    if (node) {
      targetSymbol = node.confSymbol || node.item?.symbol || node.item?.id;
      targetGroup  = node.groupName;
      targetName   = node.item?.name || targetSymbol;
    } else {
      // 未传 node 时弹窗供用户选择
      const allItems: { label: string; description: string; group: string; symbol: string }[] = [];
      for (const [grp, items] of Object.entries(watchlist)) {
        for (const it of items ?? []) {
          if (!it?.symbol) continue;
          allItems.push({
            label: it.name || it.symbol,
            description: `分组: ${grp} · 代码: ${it.symbol}`,
            group: grp,
            symbol: it.symbol,
          });
        }
      }

      if (allItems.length === 0) {
        vscode.window.showInformationMessage("MarketLens: 当前自选列表为空");
        return;
      }

      const picked = await vscode.window.showQuickPick(allItems, {
        title: "选择要删除的自选项目",
        placeHolder: "搜索股票、币对或合约地址",
      });
      if (!picked) { return; }
      targetSymbol = picked.symbol;
      targetGroup  = picked.group;
      targetName   = picked.label;
    }

    if (!targetSymbol) { return; }

    // 二次确认，防止手滑误删
    const confirm = await vscode.window.showWarningMessage(
      `确定要从自选中删除 "${targetName || targetSymbol}" 吗？`,
      { modal: true },
      "删除",
      "取消"
    );
    if (confirm !== "删除") { return; }

    const matchItem = (it?: { symbol?: string; name?: string } | null): boolean => {
      if (!it || !it.symbol || !targetSymbol) return false;
      if (isSameSymbol(it.symbol, targetSymbol)) return true;
      if (it.name && targetName && it.name.toLowerCase() === targetName.toLowerCase()) return true;
      if (node?.item?.id && isSameSymbol(it.symbol, node.item.id)) return true;
      if (node?.item?.symbol && isSameSymbol(it.symbol, node.item.symbol)) return true;
      return false;
    };

    // 保存更新到全局配置
    try {
      // 从分组中移除该项
      let removed = false;
      for (const [grp, items] of Object.entries(watchlist)) {
        if (targetGroup && grp !== targetGroup) { continue; }
        if (!Array.isArray(items)) { continue; }
        const beforeLen = items.length;
        const filtered = items.filter((it) => !matchItem(it));
        if (filtered.length !== beforeLen) {
          watchlist[grp] = filtered;
          removed = true;
        }
      }

      // 若特定分组未匹配，进行全局清理兜底
      if (!removed) {
        for (const [grp, items] of Object.entries(watchlist)) {
          if (!Array.isArray(items)) { continue; }
          const beforeLen = items.length;
          const filtered = items.filter((it) => !matchItem(it));
          if (filtered.length !== beforeLen) {
            watchlist[grp] = filtered;
            removed = true;
          }
        }
      }

      await vscode.workspace
        .getConfiguration("marketlens")
        .update("watchlist", watchlist, vscode.ConfigurationTarget.Global);

      // 检查该标的是否在其它分组中依然保留；若全部分组均已不存在该标的，同步清理孤儿预警规则与缓存
      let stillExists = false;
      for (const items of Object.values(watchlist)) {
        if (items && items.some((it) => matchItem(it))) {
          stillExists = true;
          break;
        }
      }

      if (!stillExists) {
        // 清理孤儿预警规则
        const currentAlerts = { ...(cfg.alerts || {}) };
        const keysToDelete = new Set<string>();
        if (targetSymbol) {
          keysToDelete.add(targetSymbol);
          keysToDelete.add(targetSymbol.toLowerCase());
          keysToDelete.add(normalizeSymbolKey(targetSymbol));
        }
        if (node?.item?.id) {
          keysToDelete.add(node.item.id);
          keysToDelete.add(node.item.id.toLowerCase());
          keysToDelete.add(normalizeSymbolKey(node.item.id));
        }
        if (node?.item?.symbol) {
          keysToDelete.add(node.item.symbol);
          keysToDelete.add(node.item.symbol.toLowerCase());
          keysToDelete.add(normalizeSymbolKey(node.item.symbol));
        }

        let alertModified = false;
        for (const k of keysToDelete) {
          if (k && k in currentAlerts) {
            delete currentAlerts[k];
            alertModified = true;
          }
        }

        if (alertModified) {
          await vscode.workspace
            .getConfiguration("marketlens")
            .update("alerts", currentAlerts, vscode.ConfigurationTarget.Global);
          this.treeProvider?.setAlerts(currentAlerts);
        }

        // 清理缓存（支持原生代码、小写、无符号及 normalizeSymbolKey 规范化键）
        if (targetSymbol) {
          this.quoteCache.delete(targetSymbol.toLowerCase());
          this.quoteCache.delete(targetSymbol.toLowerCase().replace(/[\._\-]/g, ""));
          const normTarget = normalizeSymbolKey(targetSymbol);
          if (normTarget) { this.quoteCache.delete(normTarget); }
        }
        if (node?.item?.id) {
          this.quoteCache.delete(node.item.id.toLowerCase());
          const normId = normalizeSymbolKey(node.item.id);
          if (normId) { this.quoteCache.delete(normId); }
        }
        if (node?.item?.symbol) {
          this.quoteCache.delete(node.item.symbol.toLowerCase());
          const normSym = normalizeSymbolKey(node.item.symbol);
          if (normSym) { this.quoteCache.delete(normSym); }
        }
      }

      // 重新构建树视图
      this.rebuildTree(watchlist);
      SettingsWebviewPanel.syncSettings();

      vscode.window.setStatusBarMessage(`$(trash) 已删除 "${targetName || targetSymbol}"`, 3000);
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `无法更新设置：${err?.message || err}。请检查 VS Code 的 settings.json 文件是否包含语法错误。`
      );
    }
  }

  /**
   * 设置标的价格预警（向导式 QuickPick）
   */
  public async setAlert(node?: StockItem): Promise<void> {
    let targetSymbol: string | undefined;
    let targetName: string | undefined;
    let currentPrice: number | undefined;

    if (node && node.item) {
      targetSymbol = node.confSymbol || node.item.symbol;
      targetName = resolveItemDisplayName(node.confName, node.confSymbol, node.item);
      currentPrice = node.item.price;
    } else {
      // 若非右键点击触发，则提供自选标的列表以供选择
      const cfg = readConfig();
      const allItems: Array<{ label: string; description: string; symbol: string; currentPrice?: number }> = [];
      for (const [grp, items] of Object.entries(cfg.watchlist)) {
        for (const item of items ?? []) {
          if (!item?.symbol) continue;
          const normKey = normalizeSymbolKey(item.symbol);
          const cached = this.quoteCache.get(normKey) || this.quoteCache.get(item.symbol);
          const finalName = resolveItemDisplayName(item.name, item.symbol, cached);
          allItems.push({
            label: finalName,
            description: `${grp} · ${item.symbol} ${cached?.price ? `(现价: ${cached.price})` : ""}`,
            symbol: item.symbol,
            currentPrice: cached?.price,
          });
        }
      }

      if (allItems.length === 0) {
        vscode.window.showInformationMessage("自选列表为空，请先添加自选标的");
        return;
      }

      const picked = await vscode.window.showQuickPick(allItems, {
        title: "选择要设置预警的自选标的",
        placeHolder: "搜索股票、币对或合约地址",
      });
      if (!picked) return;
      targetSymbol = picked.symbol;
      targetName = picked.label;
      currentPrice = picked.currentPrice;
    }

    if (!targetSymbol) return;
    const normKey = normalizeSymbolKey(targetSymbol) || targetSymbol.toLowerCase();

    const cfg = readConfig();
    const existingAlerts = { ...(cfg.alerts || {}) };
    const existing = existingAlerts[normKey] || { symbol: targetSymbol, name: targetName, enabled: true };

    const priceHint = currentPrice ? `当前现价: ${currentPrice}` : "暂无现价";
    const aboveHint = existing.above !== undefined ? ` (当前: ≥ ${existing.above})` : "";
    const belowHint = existing.below !== undefined ? ` (当前: ≤ ${existing.below})` : "";
    const pctHint   = existing.changePercent !== undefined ? ` (当前: ±${existing.changePercent}%)` : "";

    const conditionOptions = [
      {
        label: `$(arrow-up) 突破上限预警 (高于目标价)${aboveHint}`,
        action: "above",
        description: "现价大于等于目标值时提醒",
      },
      {
        label: `$(arrow-down) 跌破下限预警 (低于目标价)${belowHint}`,
        action: "below",
        description: "现价小于等于目标值时提醒",
      },
      {
        label: `$(pulse) 单日剧烈波动预警 (涨跌幅突破)${pctHint}`,
        action: "changePercent",
        description: "日内涨跌幅绝对值超过阈值百分比时提醒",
      },
      {
        label: "$(trash) 清除此标的预警",
        action: "clear",
        description: "删除该标的所有预警规则",
      },
    ];

    const pickedCond = await vscode.window.showQuickPick(conditionOptions, {
      title: `为【${targetName || targetSymbol}】设置预警 (${priceHint})`,
      placeHolder: "选择预警类型",
    });

    if (!pickedCond) return;

    if (pickedCond.action === "clear") {
      delete existingAlerts[normKey];
      await vscode.workspace
        .getConfiguration("marketlens")
        .update("alerts", existingAlerts, vscode.ConfigurationTarget.Global);
      this.rebuildTree();
      SettingsWebviewPanel.syncSettings();
      vscode.window.setStatusBarMessage(`$(bell-slash) 已清除【${targetName || targetSymbol}】的所有预警`, 3000);
      return;
    }

    let prompt = "";
    let defaultValue = "";
    if (pickedCond.action === "above") {
      prompt = `请输入【${targetName || targetSymbol}】突破上限价格（需大于 0，现价 ${currentPrice || "--"}）:`;
      defaultValue = existing.above ? String(existing.above) : currentPrice ? String(currentPrice) : "";
    } else if (pickedCond.action === "below") {
      prompt = `请输入【${targetName || targetSymbol}】跌破下限价格（需大于 0，现价 ${currentPrice || "--"}）:`;
      defaultValue = existing.below ? String(existing.below) : currentPrice ? String(currentPrice) : "";
    } else if (pickedCond.action === "changePercent") {
      prompt = `请输入【${targetName || targetSymbol}】单日涨跌幅阈值百分比（如输入 5 表示涨跌超 5% 预警）:`;
      defaultValue = existing.changePercent ? String(existing.changePercent) : "5";
    }

    const inputVal = await vscode.window.showInputBox({
      title: `设置预警阈值 · ${targetName || targetSymbol}`,
      prompt,
      value: defaultValue,
      validateInput: (val) => {
        const num = parseFloat(val);
        if (isNaN(num) || num <= 0) {
          return "请输入大于 0 的有效正数";
        }
        return null;
      },
    });

    if (!inputVal) return;
    const numVal = parseFloat(inputVal);

    const updatedItem: PriceAlertItem = {
      ...existing,
      symbol: targetSymbol,
      name: targetName,
      enabled: true,
    };

    if (pickedCond.action === "above") {
      updatedItem.above = numVal;
    } else if (pickedCond.action === "below") {
      updatedItem.below = numVal;
    } else if (pickedCond.action === "changePercent") {
      updatedItem.changePercent = numVal;
    }

    existingAlerts[normKey] = updatedItem;

    try {
      await vscode.workspace
        .getConfiguration("marketlens")
        .update("alerts", existingAlerts, vscode.ConfigurationTarget.Global);
      this.rebuildTree();
      SettingsWebviewPanel.syncSettings();
      vscode.window.setStatusBarMessage(
        `$(bell) 已设置【${targetName || targetSymbol}】预警规则`,
        3000
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`保存预警失败: ${err?.message || err}`);
    }
  }
}
