import * as vscode from "vscode";
import { StockItem, WatchlistProvider } from "./ui/watchlistProvider.ts";
import type { MarketItem, PriceAlertItem, WatchlistConfig, WatchConfigItem, AssetType } from "./types/index.ts";
import { isSameSymbol, normalizeSymbolKey, resolveItemDisplayName, batchReorderWatchlist, type ReorderItemDescriptor } from "./utils/symbolHelper.ts";
import { validateAndParseInput, type ParsedItemInput } from "./utils/inputValidator.ts";
import { searchSymbols } from "./services/symbolSearchService.ts";
import { readConfig } from "./utils/config.ts";
import { SettingsWebviewPanel } from "./ui/settingsWebview.ts";
import { logger } from "./utils/logger.ts";
import { canOpenPrompt, emitStatusMessage, isBossKeyActive, maskNumbers, showInfoMessage } from "./utils/feedback.ts";

export interface WatchlistOpsContext {
  quoteCache: Map<string, MarketItem>;
  rebuildTree: (customWatchlist?: WatchlistConfig) => void;
  treeProvider?: WatchlistProvider;
  refresh?: ((forceAll: boolean, customWatchlist?: WatchlistConfig) => Promise<void>) | undefined;
  fetchAndCacheSymbols?: ((items: { symbol: string; type: AssetType; groupName: string }[]) => Promise<MarketItem[]>) | undefined;
}

interface AddItemQuickPickItem extends vscode.QuickPickItem {
  detected: ParsedItemInput;
  suggestedName?: string;
}

export class WatchlistOps {
  private readonly quoteCache: Map<string, MarketItem>;
  private readonly rebuildTree: (customWatchlist?: WatchlistConfig) => void;
  // 上下文里 treeProvider 可缺省，构造时存入 `undefined`，故声明为必需可空而非可选键
  private readonly treeProvider: WatchlistProvider | undefined;
  private readonly refresh: ((forceAll: boolean, customWatchlist?: WatchlistConfig) => Promise<void>) | undefined;
  private readonly fetchAndCacheSymbols: ((items: { symbol: string; type: AssetType; groupName: string }[]) => Promise<MarketItem[]>) | undefined;

  constructor(context: WatchlistOpsContext) {
    this.quoteCache = context.quoteCache;
    this.rebuildTree = context.rebuildTree;
    this.treeProvider = context.treeProvider;
    this.refresh = context.refresh;
    this.fetchAndCacheSymbols = context.fetchAndCacheSymbols;
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
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`调整标的顺序失败: ${(err as Error)?.message || String(err)}`);
    }
  }

  /**
   * 弹出输入/联想选择框（方案 A：QuickPick 动态实时联想）
   * - 输入代码/币对/合约时：本地规则 0ms 零延迟置顶直接添加项；
   * - 输入拼音缩写/中文名时：防抖 250ms 请求 Smartbox 联想候选；
   * - 完美回退：支持 mock vscode 环境下的自动化测试向导桥接。
   */
  private async promptForSymbol(): Promise<{ detected: ParsedItemInput; suggestedName?: string } | undefined> {
    return new Promise((resolve) => {
      const qp = vscode.window.createQuickPick<AddItemQuickPickItem>();

      qp.title = "添加自选标的 (支持代码 / 拼音缩写 / 中文名 / 币对 / 合约)";
      qp.placeholder = "如：600519、gzmt、贵州茅台、BTCUSDT、AAPL、0x...";
      qp.ignoreFocusOut = true;
      qp.matchOnDescription = true;
      qp.matchOnDetail = true;

      // 绑定校验函数供 mock 测试环境识别
      (qp as any)._validateInput = (v: string) => {
        const res = validateAndParseInput(v);
        return res.error ? res.error : undefined;
      };

      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      let resolved = false;

      const cleanup = () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = undefined;
        }
        qp.dispose();
      };

      const finish = (res?: { detected: ParsedItemInput; suggestedName?: string }) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(res);
        }
      };

      qp.onDidChangeValue((rawVal) => {
        const val = rawVal.trim();
        if (!val) {
          qp.items = [];
          qp.busy = false;
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = undefined;
          }
          return;
        }

        // 1. 本地即时校验与置顶候选 (0ms 零等待)
        const localRes = validateAndParseInput(val);
        const directItems: AddItemQuickPickItem[] = [];

        if (localRes.parsed) {
          directItems.push({
            label: `$(add) 直接添加: ${localRes.parsed.symbol}`,
            description: `[${localRes.parsed.defaultGroup}] ${localRes.parsed.hint}`,
            detected: localRes.parsed,
            alwaysShow: true,
          });
        }
        qp.items = directItems;

        // 2. 异步网络 Smartbox 联想 (防抖 250ms)
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        qp.busy = true;
        debounceTimer = setTimeout(() => {
          void (async () => {
            try {
              const remoteItems = await searchSymbols(val);
              if (qp.value.trim() !== val) {
                return;
              }

              const combined: AddItemQuickPickItem[] = [];

              if (localRes.parsed) {
                combined.push(directItems[0]!);
              }

              for (const item of remoteItems) {
                if (localRes.parsed && isSameSymbol(item.symbol, localRes.parsed.symbol)) {
                  continue;
                }
                const icon =
                  item.defaultGroup === "基金"
                    ? "$(credit-card)"
                    : item.type === "HK_STOCK"
                    ? "$(globe)"
                    : item.type === "US_STOCK"
                    ? "$(organization)"
                    : item.type === "CRYPTO"
                    ? "$(shield)"
                    : "$(graph)";

                const pickItem: AddItemQuickPickItem = {
                  label: `${icon} ${item.name} (${item.symbol})`,
                  description: `[${item.defaultGroup}] ${item.hint}`,
                  detected: {
                    symbol: item.symbol,
                    type: item.type,
                    defaultGroup: item.defaultGroup,
                    hint: `${item.name} (${item.symbol})`,
                  },
                  suggestedName: item.name,
                };
                if (item.pinyin) {
                  pickItem.detail = `拼音: ${item.pinyin}`;
                }
                combined.push(pickItem);
              }

              qp.items = combined;
            } catch (err: unknown) {
              logger.debug("[WatchlistOps] symbol search error", err);
            } finally {
              if (qp.value.trim() === val) {
                qp.busy = false;
              }
            }
          })();
        }, 250);
      });

      qp.onDidAccept(() => {
        const selected = qp.selectedItems[0] || qp.activeItems[0];
        if (selected && selected.detected) {
          const itemRes: { detected: ParsedItemInput; suggestedName?: string } = {
            detected: selected.detected,
          };
          if (selected.suggestedName) {
            itemRes.suggestedName = selected.suggestedName;
          }
          finish(itemRes);
          return;
        }

        const val = qp.value.trim();
        if (!val) {
          finish(undefined);
          return;
        }

        const fallback = validateAndParseInput(val);
        if (fallback.parsed) {
          finish({ detected: fallback.parsed });
        } else {
          vscode.window.showErrorMessage(fallback.error || "输入格式不合法，未检索到对应标的");
          finish(undefined);
        }
      });

      qp.onDidHide(() => {
        finish(undefined);
      });

      qp.show();
    });
  }

  /**
   * 添加自选（支持代码 / 拼音缩写 / 中文名联想检索）
   */
  public async addItem(): Promise<void> {
    // 守卫下沉：本模块可读到全部真实自选名称、代码与现价，命令层之外（菜单、其他扩展调用）
    // 同样能直达此处，故入口自带判定。addItem 无 node 上下文，脱敏态一律静默拒绝。
    if (!canOpenPrompt(false)) {
      logger.info("专注/简洁展示模式激活期间拒绝添加自选标的（模块级脱敏守卫）");
      return;
    }

    // ── Step 1: 获取用户输入（支持代码/拼音/中文实时联想） ────────
    const picked = await this.promptForSymbol();
    if (!picked) { return; }

    const detected = picked.detected;
    const sym = detected.symbol;

    // ── Step 2: 严格锁定到匹配的系统专属分组（防呆拦截跨市场错配，暂不支持自定义分组） ─
    const watchlist: WatchlistConfig =
      vscode.workspace.getConfiguration("marketlens").get<WatchlistConfig>("watchlist", {});

    const validGroups: string[] = [];
    if (detected.defaultGroup) {
      validGroups.push(detected.defaultGroup);
    }
    if (detected.alternativeGroup && !validGroups.includes(detected.alternativeGroup)) {
      validGroups.push(detected.alternativeGroup);
    }
    // 特殊兼容：若是 ETF/场内基金，允许在“基金”和“A股”之间选择
    if (detected.type === "A_SHARE" && detected.defaultGroup === "基金" && !validGroups.includes("A股")) {
      validGroups.push("A股");
    }
    if (validGroups.length === 0) {
      validGroups.push(detected.defaultGroup || "A股");
    }

    let targetGroup = validGroups[0]!;
    // 仅当存在多个合规系统分组（如 ETF 选 基金 vs A股，或 BTC 选 Binance vs 美股）时才弹窗；
    // 分组唯一时自动直达，无需让用户重复确认唯一选项
    if (validGroups.length > 1) {
      const pickedGroup = await vscode.window.showQuickPick(validGroups, {
        title: `添加 "${sym}" (${detected.hint}) 到哪个系统分组？`,
        placeHolder: `自动匹配系统分组：${validGroups[0]}（按 Enter 确认）`,
      });
      if (!pickedGroup) { return; }
      targetGroup = pickedGroup;
    }

    // ── Step 3: 检查是否已存在（去重）───────────────────────────
    const groupItems: WatchConfigItem[] = watchlist[targetGroup] ?? [];
    const alreadyExists = groupItems.some(
      (item) => isSameSymbol(item?.symbol, sym) || item?.symbol?.toLowerCase() === sym.toLowerCase()
    );
    if (alreadyExists) {
      vscode.window.showWarningMessage(
        `MarketLens: "${sym}" 已在分组 "${targetGroup}" 中`
      );
      return;
    }

    // ── Step 3.5: 确定显示名称 ───────────────────────────────────
    // 若联想搜索已带官方名称（如“长鑫科技”、“贵州茅台”），直接采用并一键落盘，杜绝多次按回车；
    // 仅当输入裸代码（无 suggestedName）时，才提示输入自定义显示名称。
    let finalName = picked.suggestedName || sym;
    if (!picked.suggestedName) {
      const defaultPlaceholder = detected.type === "US_STOCK" && sym.toUpperCase() === "TSLA" ? "特斯拉" : sym;
      const customNameInput = await vscode.window.showInputBox({
        title: `为 "${sym}" 设置显示名称（可选）`,
        prompt: "直接按 Enter 默认使用标的代码作为显示名称",
        placeHolder: `如：${defaultPlaceholder}`,
      });
      if (customNameInput === undefined) {
        return; // 用户按下 Esc 取消
      }
      finalName = customNameInput.trim() || sym;
    }

    // ── Step 4: 写入 settings.json ───────────────────────────────
    let finalType = detected.type;
    let symToSave = sym;
    if (detected.alternativeType) {
      if (detected.alternativeGroup && targetGroup.toLowerCase().includes(detected.alternativeGroup.toLowerCase())) {
        finalType = detected.alternativeType;
        if (finalType === "CRYPTO" && !/(USDT|USDC|FDUSD|BUSD|BTC|ETH)$/i.test(symToSave)) {
          symToSave = `${symToSave.toUpperCase()}USDT`;
        } else if (finalType === "US_STOCK" && /(USDT|USDC)$/i.test(symToSave)) {
          symToSave = symToSave.replace(/(USDT|USDC)$/i, "");
        }
      } else if (targetGroup.includes("港股") || /\bhk\b/i.test(targetGroup)) {
        finalType = "HK_STOCK";
      } else if (targetGroup.includes("美股") || /\bus\b/i.test(targetGroup)) {
        finalType = "US_STOCK";
        if (/(USDT|USDC)$/i.test(symToSave)) {
          symToSave = symToSave.replace(/(USDT|USDC)$/i, "");
        }
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

      // 立即针对新增标的发起定向高速拉取并直接写入内存缓存（彻底消除全量轮询锁、VS Code 异步落盘与休市时序抖动）
      try {
        if (this.fetchAndCacheSymbols) {
          await this.fetchAndCacheSymbols([{ symbol: symToSave, type: finalType, groupName: targetGroup }]);
        } else if (this.refresh) {
          await this.refresh(true, updated);
        } else {
          await vscode.commands.executeCommand("marketlens.refresh");
        }
      } catch (err) {
        logger.debug("[addItem] instant symbol fetch error", err);
      }

      // 拉取后（已写入 quoteCache）一次性重建树视图与设置面板，杜绝先显示“获取行情中...”的短暂闪烁
      this.rebuildTree(updated);
      SettingsWebviewPanel.syncSettings();

      const displayDesc = finalName !== sym ? `${finalName} (${sym})` : sym;
      emitStatusMessage(maskNumbers(`$(check) 已添加 "${displayDesc}" 到 ${targetGroup}`), 3000);
    } catch (err: unknown) {
      vscode.window.showErrorMessage(
        `无法写入用户设置：${(err as Error)?.message || String(err)}。请检查 VS Code 的 settings.json 文件是否包含语法错误。`
      );
    }
  }

  /**
   * 置顶标的（点击图钉图标或命令触发）
   */
  public async pinToTop(node?: StockItem): Promise<void> {
    if (!canOpenPrompt(Boolean(node))) {
      logger.info("专注/简洁展示模式激活期间拒绝置顶标的（模块级脱敏守卫）");
      return;
    }

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
        showInfoMessage("MarketLens: 当前自选列表为空");
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
      emitStatusMessage(maskNumbers(`$(info) "${targetName || targetSymbol}" 已在最顶部`), 2500);
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

      emitStatusMessage(maskNumbers(`$(pin) 已将 "${targetName || targetSymbol}" 置顶`), 3000);
    } catch (err: unknown) {
      vscode.window.showErrorMessage(
        `无法更新设置：${(err as Error)?.message || String(err)}。请检查 VS Code 的 settings.json 文件是否包含语法错误。`
      );
    }
  }

  /**
   * 删除自选（点击垃圾桶图标或命令触发）
   */
  public async removeItem(node?: StockItem): Promise<void> {
    if (!canOpenPrompt(Boolean(node))) {
      logger.info("专注/简洁展示模式激活期间拒绝删除自选（模块级脱敏守卫）");
      return;
    }

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
        showInfoMessage("MarketLens: 当前自选列表为空");
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

    // 匹配只认符号身份（isSameSymbol 与节点 id/symbol），严禁以显示名称相等作为删除判据：
    // 跨市场同名标的（不同代码、同中文名）会因名称命中而被连带误删（AGENTS.md §5.5）。
    // targetName 仅用于展示与确认文案，不进入匹配谓词。
    const matchItem = (it?: { symbol?: string } | null): boolean => {
      if (!it || !it.symbol || !targetSymbol) return false;
      if (isSameSymbol(it.symbol, targetSymbol)) return true;
      if (node?.item?.id && isSameSymbol(it.symbol, node.item.id)) return true;
      if (node?.item?.symbol && isSameSymbol(it.symbol, node.item.symbol)) return true;
      return false;
    };

    // 严格限定在目标分组内移除；targetGroup 已锁定时不得越组做全局兜底清扫
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

    if (!removed) {
      showInfoMessage(
        `MarketLens: 未在${targetGroup ? `分组【${targetGroup}】的` : ""}自选里找到 "${targetName || targetSymbol}"`
      );
      return;
    }

    // 保存更新到全局配置
    try {
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

      emitStatusMessage(maskNumbers(`$(trash) 已删除 "${targetName || targetSymbol}"`), 3000);
    } catch (err: unknown) {
      vscode.window.showErrorMessage(
        `无法更新设置：${(err as Error)?.message || String(err)}。请检查 VS Code 的 settings.json 文件是否包含语法错误。`
      );
    }
  }

  /**
   * 设置标的价格预警（向导式 QuickPick）
   */
  public async setAlert(node?: StockItem): Promise<void> {
    if (!canOpenPrompt(Boolean(node))) {
      logger.info("专注/简洁展示模式激活期间拒绝设置预警（模块级脱敏守卫）");
      return;
    }

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
      const allItems: Array<{ label: string; description: string; symbol: string; currentPrice?: number | undefined }> = [];
      for (const [grp, items] of Object.entries(cfg.watchlist)) {
        for (const item of items ?? []) {
          if (!item?.symbol) continue;
          const normKey = normalizeSymbolKey(item.symbol);
          const cached = this.quoteCache.get(normKey) || this.quoteCache.get(item.symbol);
          const finalName = resolveItemDisplayName(item.name, item.symbol, cached);
          allItems.push({
            label: finalName,
            description: maskNumbers(`${grp} · ${item.symbol} ${cached?.price ? `(现价: ${cached.price})` : ""}`),
            symbol: item.symbol,
            currentPrice: cached?.price,
          });
        }
      }

      if (allItems.length === 0) {
        showInfoMessage("自选列表为空，请先添加自选标的");
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

    // 出口 A：向导文案保留标的名以便确认目标，但现价与既有阈值属敏感数值，脱敏态一律打码
    const priceHint = currentPrice ? maskNumbers(`当前现价: ${currentPrice}`) : "暂无现价";
    const aboveHint = existing.above !== undefined ? maskNumbers(` (当前: ≥ ${existing.above})`) : "";
    const belowHint = existing.below !== undefined ? maskNumbers(` (当前: ≤ ${existing.below})`) : "";
    const pctHint   = existing.changePercent !== undefined ? maskNumbers(` (当前: ±${existing.changePercent}%)`) : "";

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
      emitStatusMessage(maskNumbers(`$(bell-slash) 已清除【${targetName || targetSymbol}】的所有预警`), 3000);
      return;
    }

    let prompt = "";
    let defaultValue = "";
    if (pickedCond.action === "above") {
      prompt = maskNumbers(`请输入【${targetName || targetSymbol}】突破上限价格（需大于 0，现价 ${currentPrice || "--"}）:`);
      defaultValue = existing.above ? String(existing.above) : currentPrice ? String(currentPrice) : "";
    } else if (pickedCond.action === "below") {
      prompt = maskNumbers(`请输入【${targetName || targetSymbol}】跌破下限价格（需大于 0，现价 ${currentPrice || "--"}）:`);
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
      emitStatusMessage(
        maskNumbers(`$(bell) 已设置【${targetName || targetSymbol}】预警规则`),
        3000
      );
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`保存预警失败: ${(err as Error)?.message || String(err)}`);
    }
  }

  /**
   * 设置标的持仓成本与数量 (F1: Cost & PnL)
   */
  public async setHolding(node?: StockItem): Promise<void> {
    if (!canOpenPrompt(Boolean(node))) {
      logger.info("专注/简洁展示模式激活期间拒绝设置持仓（模块级脱敏守卫）");
      return;
    }

    let targetGroup: string | undefined;
    let targetSymbol: string | undefined;
    let targetName: string | undefined;
    let currentPrice: number | undefined;

    if (node && node.item) {
      targetGroup = node.groupName;
      targetSymbol = node.confSymbol || node.item.symbol;
      targetName = resolveItemDisplayName(node.confName, node.confSymbol, node.item);
      currentPrice = node.item.price;
    } else {
      const cfg = readConfig();
      const allItems: Array<{
        label: string;
        description: string;
        group: string;
        symbol: string;
        currentPrice?: number | undefined;
      }> = [];

      for (const [grp, items] of Object.entries(cfg.watchlist)) {
        for (const item of items ?? []) {
          if (!item?.symbol) continue;
          const normKey = normalizeSymbolKey(item.symbol);
          const cached = this.quoteCache.get(normKey) || this.quoteCache.get(item.symbol);
          const finalName = resolveItemDisplayName(item.name, item.symbol, cached);
          const holdingDesc =
            item.cost !== undefined && item.shares !== undefined
              ? ` · [持仓: ${item.shares} 股/份, 成本: ${item.cost}]`
              : "";
          allItems.push({
            label: finalName,
            description: maskNumbers(`${grp} · ${item.symbol}${holdingDesc}`),
            group: grp,
            symbol: item.symbol,
            currentPrice: cached?.price,
          });
        }
      }

      if (allItems.length === 0) {
        showInfoMessage("自选列表为空，请先添加自选标的");
        return;
      }

      const picked = await vscode.window.showQuickPick(allItems, {
        title: "选择要设置持仓成本的标的",
        placeHolder: "搜索股票、币对或代币",
      });
      if (!picked) return;
      targetGroup = picked.group;
      targetSymbol = picked.symbol;
      targetName = picked.label;
      currentPrice = picked.currentPrice;
    }

    if (!targetGroup || !targetSymbol) return;

    const cfg = readConfig();
    const watchlist = { ...cfg.watchlist };
    const groupList = [...(watchlist[targetGroup] || [])];
    const itemIndex = groupList.findIndex(
      (it) => normalizeSymbolKey(it.symbol) === normalizeSymbolKey(targetSymbol!) || it.symbol === targetSymbol
    );
    if (itemIndex === -1) {
      vscode.window.showWarningMessage(`未在分组【${targetGroup}】中找到标的 ${targetSymbol}`);
      return;
    }

    const currentItem = { ...groupList[itemIndex] };
    const initialCost = currentItem.cost !== undefined ? String(currentItem.cost) : "";
    const initialShares = currentItem.shares !== undefined ? String(currentItem.shares) : "";

    const pricePrompt = currentPrice && currentPrice > 0 ? maskNumbers(` (当前现价: ${currentPrice})`) : "";
    const costInput = await vscode.window.showInputBox({
      title: `设置持仓成本 - ${targetName} (${targetSymbol})`,
      prompt: `请输入买入成本单价${pricePrompt}，留空或输入 0 则清除持仓`,
      value: initialCost,
      validateInput: (v) => {
        const trimmed = v.trim();
        if (!trimmed || trimmed === "0") return null;
        const num = parseFloat(trimmed);
        if (!Number.isFinite(num) || num < 0) return "请输入合法的非负有效数字";
        return null;
      },
    });

    if (costInput === undefined) return;

    const trimmedCost = costInput.trim();
    if (!trimmedCost || trimmedCost === "0") {
      delete currentItem.cost;
      delete currentItem.shares;
      groupList[itemIndex] = currentItem;
      watchlist[targetGroup] = groupList;
      try {
        await vscode.workspace
          .getConfiguration("marketlens")
          .update("watchlist", watchlist, vscode.ConfigurationTarget.Global);
        this.rebuildTree(watchlist);
        SettingsWebviewPanel.syncSettings();
        showInfoMessage(maskNumbers(`已清除【${targetName}】的持仓信息`));
      } catch (err: unknown) {
        vscode.window.showErrorMessage(`清除持仓失败: ${(err as Error)?.message || String(err)}`);
      }
      return;
    }

    const costVal = parseFloat(trimmedCost);
    if (!Number.isFinite(costVal) || costVal <= 0) return;

    const sharesInput = await vscode.window.showInputBox({
      title: `设置持仓数量 - ${targetName} (${targetSymbol})`,
      prompt: `请输入持仓数量 / 股数 / 币数`,
      value: initialShares || "100",
      validateInput: (v) => {
        const trimmed = v.trim();
        if (!trimmed) return "持仓数量不能为空";
        const num = parseFloat(trimmed);
        if (!Number.isFinite(num) || num <= 0) return "持仓数量必须为大于 0 的有效数字";
        return null;
      },
    });

    if (sharesInput === undefined) return;

    const sharesVal = parseFloat(sharesInput.trim());
    if (!Number.isFinite(sharesVal) || sharesVal <= 0) return;
    currentItem.cost = costVal;
    currentItem.shares = sharesVal;
    groupList[itemIndex] = currentItem;
    watchlist[targetGroup] = groupList;

    try {
      await vscode.workspace
        .getConfiguration("marketlens")
        .update("watchlist", watchlist, vscode.ConfigurationTarget.Global);
      this.rebuildTree(watchlist);
      SettingsWebviewPanel.syncSettings();
      showInfoMessage(
        maskNumbers(`✅ 已设置【${targetName}】持仓：${sharesVal} 股/份，成本价 ${costVal}`)
      );
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`保存持仓失败: ${(err as Error)?.message || String(err)}`);
    }
  }

  /**
   * 一键添加核心大盘指数到自选列表 (F2: Core Indices)
   */
  public async addCommonIndices(): Promise<void> {
    // 该向导写入的是固定的公开指数代码，不涉及用户既有自选，故简洁展示态可正常使用；
    // 老板键激活期间仍须完全静默（一票否决）。
    if (isBossKeyActive()) {
      logger.info("专注模式激活期间拒绝添加大盘指数（模块级脱敏守卫）");
      return;
    }

    const COMMON_INDICES: Array<{
      group: string;
      symbol: string;
      name: string;
      type: AssetType;
    }> = [
      { group: "A股", symbol: "sh000001", name: "上证指数", type: "A_SHARE" },
      { group: "A股", symbol: "sz399001", name: "深证成指", type: "A_SHARE" },
      { group: "A股", symbol: "sz399006", name: "创业板指", type: "A_SHARE" },
      { group: "港股", symbol: "hkHSI", name: "恒生指数", type: "HK_STOCK" },
      { group: "港股", symbol: "hkHSTECH", name: "恒生科技", type: "HK_STOCK" },
      { group: "美股", symbol: "us.IXIC", name: "纳斯达克", type: "US_STOCK" },
      { group: "美股", symbol: "us.INX", name: "标普500", type: "US_STOCK" },
      { group: "美股", symbol: "us.DJI", name: "道琼斯", type: "US_STOCK" },
      { group: "Binance", symbol: "BTCUSDT", name: "比特币", type: "CRYPTO" },
    ];

    const cfg = readConfig();
    const watchlist: WatchlistConfig = {};
    for (const [k, v] of Object.entries(cfg.watchlist)) {
      watchlist[k] = [...(v || [])];
    }

    let addedCount = 0;
    for (const item of COMMON_INDICES) {
      const list = watchlist[item.group] || [];
      const exists = list.some(
        (it) => normalizeSymbolKey(it.symbol) === normalizeSymbolKey(item.symbol)
      );
      if (!exists) {
        list.push({
          symbol: item.symbol,
          name: item.name,
          type: item.type,
        });
        watchlist[item.group] = list;
        addedCount++;
      }
    }

    if (addedCount === 0) {
      showInfoMessage("常用大盘指数已全部在自选列表中，无需重复添加");
      return;
    }

    try {
      await vscode.workspace
        .getConfiguration("marketlens")
        .update("watchlist", watchlist, vscode.ConfigurationTarget.Global);
      this.rebuildTree(watchlist);
      SettingsWebviewPanel.syncSettings();
      try {
        if (this.refresh) {
          await this.refresh(true, watchlist);
        } else {
          await vscode.commands.executeCommand("marketlens.refresh");
        }
      } catch (err) {
        logger.debug("[addCommonIndices] refresh command failed", err);
      }
      showInfoMessage(
        `✅ 已成功添加 ${addedCount} 只常用大盘指数到自选看板！`
      );
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`添加大盘指数失败: ${(err as Error)?.message || String(err)}`);
    }
  }

  /**
   * 切换标的是否在底部状态栏参与轮播展示 (T1-4: 股票池与展示池解耦)
   */
  public async toggleStatusBarItem(node?: StockItem): Promise<void> {
    if (!canOpenPrompt(Boolean(node))) {
      logger.info("专注/简洁展示模式激活期间拒绝修改状态栏显示（模块级脱敏守卫）");
      return;
    }

    let targetGroup: string | undefined;
    let targetSymbol: string | undefined;
    let targetName: string | undefined;

    if (node && node.item) {
      targetGroup = node.groupName;
      targetSymbol = node.confSymbol || node.item.symbol;
      targetName = resolveItemDisplayName(node.confName, node.confSymbol, node.item, node.alias);
    } else {
      const cfg = readConfig();
      const allItems: Array<{ label: string; description: string; group: string; symbol: string; name: string }> = [];
      for (const [grp, items] of Object.entries(cfg.watchlist || {})) {
        for (const it of items ?? []) {
          if (!it?.symbol) continue;
          allItems.push({
            label: it.alias || it.name || it.symbol,
            description: `分组: ${grp} · 代码: ${it.symbol}`,
            group: grp,
            symbol: it.symbol,
            name: it.alias || it.name || it.symbol,
          });
        }
      }
      if (allItems.length === 0) {
        showInfoMessage("自选列表为空，无法设置。");
        return;
      }
      const picked = await vscode.window.showQuickPick(allItems, { placeHolder: "选择要切换状态栏轮播展示的标的" });
      if (!picked) return;
      targetGroup = picked.group;
      targetSymbol = picked.symbol;
      targetName = picked.name;
    }

    const cfg = readConfig();
    const updated = { ...cfg.watchlist };
    const list = updated[targetGroup] ? [...updated[targetGroup]!] : [];
    const idx = list.findIndex(
      (it) => it.symbol === targetSymbol || normalizeSymbolKey(it.symbol) === normalizeSymbolKey(targetSymbol!)
    );
    if (idx === -1) return;

    const currentItem = list[idx]!;
    // 默认是 true（轮播），切换为 false 则停用，反之重新启用
    const nextShow = currentItem.showInStatusBar === false ? true : false;
    list[idx] = {
      ...currentItem,
      showInStatusBar: nextShow,
    };
    updated[targetGroup] = list;

    await vscode.workspace.getConfiguration("marketlens").update("watchlist", updated, vscode.ConfigurationTarget.Global);
    this.rebuildTree(updated);
    SettingsWebviewPanel.syncSettings();

    const statusTip = nextShow ? "已开启状态栏轮播展示" : "已关闭状态栏轮播（仅在自选树常驻）";
    emitStatusMessage(`$(check) ${targetName} ${statusTip}`, 3000);
  }

  /**
   * 设置标的展示简称 / 别名 (T1-3)
   */
  public async setAlias(node?: StockItem): Promise<void> {
    if (!canOpenPrompt(Boolean(node))) {
      logger.info("专注/简洁展示模式激活期间拒绝修改标的别名（模块级脱敏守卫）");
      return;
    }

    let targetGroup: string | undefined;
    let targetSymbol: string | undefined;
    let currentAlias: string | undefined;
    let currentName: string | undefined;

    if (node && node.item) {
      targetGroup = node.groupName;
      targetSymbol = node.confSymbol || node.item.symbol;
      currentAlias = node.alias;
      currentName = resolveItemDisplayName(node.confName, node.confSymbol, node.item);
    } else {
      const cfg = readConfig();
      const allItems: Array<{ label: string; description: string; group: string; symbol: string; alias?: string | undefined; name: string }> = [];
      for (const [grp, items] of Object.entries(cfg.watchlist || {})) {
        for (const it of items ?? []) {
          if (!it?.symbol) continue;
          allItems.push({
            label: it.alias || it.name || it.symbol,
            description: `分组: ${grp} · 代码: ${it.symbol}${it.alias ? ` · 别名: ${it.alias}` : ""}`,
            group: grp,
            symbol: it.symbol,
            alias: it.alias,
            name: it.name || it.symbol,
          });
        }
      }
      if (allItems.length === 0) {
        showInfoMessage("自选列表为空，无法设置。");
        return;
      }
      const picked = await vscode.window.showQuickPick(allItems, { placeHolder: "选择要设置展示简称 / 别名的标的" });
      if (!picked) return;
      targetGroup = picked.group;
      targetSymbol = picked.symbol;
      currentAlias = picked.alias;
      currentName = picked.name;
    }

    const input = await vscode.window.showInputBox({
      title: `设置标的展示简称 / 别名: ${currentName} (${targetSymbol})`,
      prompt: "输入要在侧边栏和状态栏优先展示的简短别名（如“茅台”、“红利低波”）；留空清空别名并恢复默认",
      value: currentAlias || "",
      placeHolder: "例如：茅台",
    });

    if (input === undefined) return;

    const cfg = readConfig();
    const updated = { ...cfg.watchlist };
    const list = updated[targetGroup] ? [...updated[targetGroup]!] : [];
    const idx = list.findIndex(
      (it) => it.symbol === targetSymbol || normalizeSymbolKey(it.symbol) === normalizeSymbolKey(targetSymbol!)
    );
    if (idx === -1) return;

    const trimmed = input.trim();
    const currentItem = list[idx]!;
    if (trimmed) {
      list[idx] = { ...currentItem, alias: trimmed };
    } else {
      const cloned = { ...currentItem };
      delete cloned.alias;
      list[idx] = cloned;
    }
    updated[targetGroup] = list;

    await vscode.workspace.getConfiguration("marketlens").update("watchlist", updated, vscode.ConfigurationTarget.Global);
    this.rebuildTree(updated);
    SettingsWebviewPanel.syncSettings();

    const tip = trimmed ? `已设置别名为 “${trimmed}”` : "已清空别名并恢复默认";
    emitStatusMessage(`$(check) ${targetSymbol} ${tip}`, 3000);
  }
}
