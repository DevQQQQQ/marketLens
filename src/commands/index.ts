// src/commands/index.ts
import * as vscode from "vscode";
import { RefreshScheduler } from "../scheduler.ts";
import { WatchlistOps } from "../watchlistOps.ts";
import { StatusBar } from "../ui/statusBar.ts";
import { WatchlistProvider, GroupItem, StockItem } from "../ui/watchlistProvider.ts";
import { SettingsWebviewPanel } from "../ui/settingsWebview.ts";
import { readConfig } from "../utils/config.ts";
import { logger } from "../utils/logger.ts";
import { canEmitUserFeedback, resolveMaskToggle, shouldBlockNodeCommand } from "../utils/maskState.ts";

export interface CommandServices {
  scheduler: RefreshScheduler;
  watchlistOps: WatchlistOps;
  statusBar: StatusBar;
  treeProvider: WatchlistProvider;
}

/**
 * 状态栏临时消息的安全出口：老板键（专注模式）激活期间一票否决，保证完全静默。
 *
 * 注意：`vscode.window.setStatusBarMessage` 独立于 `StatusBar` 自身的 `barItem.hide()` 逻辑，
 * 行情条隐藏后该临时消息依然会在状态栏区域闪现——「已隐蔽」这类提示本身就是暴露源。
 * 所有面向用户的状态栏回显必须经由本函数，严禁直接调用 `setStatusBarMessage`。
 */
function emitStatusMessage(statusBar: StatusBar, message: string, timeout: number = 2500): void {
  if (!canEmitUserFeedback(statusBar.isBossKeyActive())) {
    return;
  }
  vscode.window.setStatusBarMessage(message, timeout);
}

export function registerCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  const { scheduler, watchlistOps, statusBar, treeProvider } = services;

  /**
   * 解除老板键（专注模式）隐身状态
   *
   * 语义约定：用户在专注模式激活期间主动表达「我要看行情」的显式操作，
   * 即构成专注模式的自然出口（与重新打开自选看板同源）。
   *
   * @param reason 触发原因，仅写入 OutputChannel 日志用于审计，不产生任何 UI 回显
   * @returns 本次调用是否实际执行了解除动作（幂等：非激活态直接返回 false）
   */
  const exitBossKey = (reason: string): boolean => {
    if (!statusBar.isBossKeyActive()) {
      return false;
    }
    statusBar.toggleBossKey(false);
    treeProvider.setBossKey(false);
    logger.info(`检测到${reason}，已自动退出专注模式`);
    return true;
  };

  context.subscriptions.push(
    // 打开设置界面（专属 Webview 控制台面板）
    vscode.commands.registerCommand("marketlens.openSettings", () => {
      // 老板键守卫：专注模式激活期间静默拒绝打开，且不解除隐身状态、不弹出任何提示。
      // 设置面板会完整列出用户的自选标的名称，此刻打开等同于自曝关注范围。
      // 需要查看行情时，请点击活动栏图标（会自动解除专注模式）或再次按下老板键。
      if (!canEmitUserFeedback(statusBar.isBossKeyActive())) {
        logger.info("专注模式激活期间拒绝打开设置面板（老板键守卫已生效）");
        return;
      }
      const extVersion = context.extension?.packageJSON?.version;
      SettingsWebviewPanel.createOrShow(context.extensionUri, extVersion);
    }),


    // 全量刷新（手动点击无论是否闭市都重新获取最新收盘/盘中数据）
    vscode.commands.registerCommand("marketlens.refresh", () => {
      void scheduler.refresh(true);
    }),

    // 分类刷新（分组节点 inline 按钮）
    vscode.commands.registerCommand(
      "marketlens.refreshGroup",
      async (group: GroupItem) => {
        if (group) {
          await scheduler.refreshGroup(group);
        }
      }
    ),

    // 全部展开（视图标题栏按钮，与 VS Code 内置的「全部折叠」配对）
    vscode.commands.registerCommand("marketlens.expandAllGroups", () => {
      treeProvider.expandAllGroups();
    }),

    // 分组排序方式（分组节点 inline 按钮及右键菜单）
    vscode.commands.registerCommand(
      "marketlens.sortGroup",
      async (group?: GroupItem) => {
        let targetGroup = group?.groupName;
        if (!targetGroup) {
          if (shouldBlockNodeCommand(statusBar.isBossKeyActive(), readConfig().maskMode, Boolean(group))) {
            logger.info("专注/简洁展示模式激活期间拒绝设置分组排序（老板键/打码守卫已生效）");
            return;
          }
          const groups = treeProvider.getGroups();
          if (groups.length === 0) {
            vscode.window.showInformationMessage("当前没有可排序的自选分组");
            return;
          }
          const pick = await vscode.window.showQuickPick(
            groups.map((g) => ({
              label: `$(folder) ${g.groupName}`,
              groupName: g.groupName,
              description: `当前模式: ${formatSortModeLabel(treeProvider.getGroupSortMode(g.groupName))}`,
            })),
            { title: "选择要设置排序的分组", placeHolder: "请选择一个自选分组" }
          );
          if (!pick) return;
          targetGroup = pick.groupName;
        }

        const currentMode = treeProvider.getGroupSortMode(targetGroup);

        interface SortQuickPickItem extends vscode.QuickPickItem {
          mode: import("../types").GroupSortMode;
        }

        const items: SortQuickPickItem[] = [
          {
            label: "$(three-bars) 默认顺序",
            description: "手动排列，支持拖拽与上下移动调整",
            detail: currentMode === "default" ? "✓ 当前生效" : undefined,
            mode: "default",
          },
          {
            label: "$(graph-line) 按涨幅排序",
            description: "涨跌幅从高到低 (涨幅优先)",
            detail: currentMode === "changeDesc" ? "✓ 当前生效" : undefined,
            mode: "changeDesc",
          },
          {
            label: "$(graph) 按跌幅排序",
            description: "涨跌幅从低到高 (跌幅优先)",
            detail: currentMode === "changeAsc" ? "✓ 当前生效" : undefined,
            mode: "changeAsc",
          },
          {
            label: "$(symbol-string) 按名称排序",
            description: "按股票名称拼音排序",
            detail: currentMode === "nameAsc" ? "✓ 当前生效" : undefined,
            mode: "nameAsc",
          },
          {
            label: "$(symbol-number) 按现价排序",
            description: "按当前价格从高到低",
            detail: currentMode === "priceDesc" ? "✓ 当前生效" : undefined,
            mode: "priceDesc",
          },
        ];

        const selected = await vscode.window.showQuickPick(items, {
          title: "选择自选股排序方式",
          placeHolder: `当前分组：${targetGroup}`,
        });

        if (selected && selected.mode !== currentMode) {
          treeProvider.setGroupSortMode(targetGroup, selected.mode);
          emitStatusMessage(
            statusBar,
            `【${targetGroup}】已切换为：${selected.label.replace(/\$\([a-z0-9-]+\)\s*/, "")}`,
            2500
          );
        }
      }
    ),

    // 老板键 — 一键隐藏 / 恢复（侧边栏、状态栏、设置窗口联动）
    vscode.commands.registerCommand("marketlens.toggleBossKey", async () => {
      const isHidden = statusBar.toggleBossKey();

      if (isHidden) {
        // 1. 关闭左侧侧边栏（如果处于开启状态）
        try {
          await vscode.commands.executeCommand("workbench.action.closeSidebar");
        } catch (err) {
          logger.debug("[toggleBossKey] closeSidebar failed", err);
        }

        // 2. 将自选树视图打码脱敏（激活老板键状态）
        treeProvider.setBossKey(true);

        // 3. 关闭正在打开的设置 Webview
        SettingsWebviewPanel.currentPanel?.dispose();

        // 4. 专注模式已激活：此处必须保持完全静默。
        // `vscode.window.setStatusBarMessage` 独立于 StatusBar.barItem.hide()，
        // 行情条虽已隐藏，但「已隐蔽」这类临时消息仍会在状态栏区域闪现，
        // 直接瓦解老板键的隐身初衷，故改为仅写入 OutputChannel 日志。
        logger.info("老板键已激活：自选看板、状态栏与设置面板均已隐蔽");
      } else {
        // 1. 恢复自选树视图原配置（解除老板键状态）
        treeProvider.setBossKey(false);
        const config = readConfig();
        treeProvider.setMaskMode(config.maskMode);

        // 2. 重新唤醒并展开左侧自选侧边栏
        try {
          await vscode.commands.executeCommand("workbench.view.extension.marketlens-container");
        } catch (err) {
          logger.debug("[toggleBossKey] open container failed", err);
        }

        // 3. 底部状态提示（此时已退出专注模式，回显安全）
        emitStatusMessage(statusBar, "$(eye) MarketLens 行情已恢复", 3000);
      }
    }),

    // 伪装摸鱼模式开关
    vscode.commands.registerCommand("marketlens.toggleMask", async () => {
      const config = readConfig();
      const plan = resolveMaskToggle(statusBar.isBossKeyActive(), config.maskMode);

      // 老板键激活期间 maskMode 被一票否决（见 isDisplayMasked）：若照常翻转并落盘，
      // 界面不会有任何变化，只会造成「配置已改、观感未变」的静默失效。
      // 按 resolveMaskToggle 的语义约定，先解除专注模式，使操作结果与用户意图一致。
      const exitedBossKey = plan.exitBossKey && exitBossKey("专注模式激活期间切换简洁展示模式");

      if (plan.requiresConfigWrite) {
        await vscode.workspace
          .getConfiguration("marketlens")
          .update("maskMode", plan.nextMaskMode, vscode.ConfigurationTarget.Global);
      }

      emitStatusMessage(
        statusBar,
        exitedBossKey
          ? "$(eye) MarketLens 已退出专注模式 (伪装摸鱼模式已关闭)"
          : plan.nextMaskMode
            ? "$(git-branch) MarketLens: 伪装摸鱼模式已开启"
            : "$(eye) MarketLens: 伪装摸鱼模式已关闭",
        2500
      );
    }),

    // 颜色脱敏开关
    vscode.commands.registerCommand("marketlens.toggleColorNeutral", async () => {
      const config = readConfig();
      const next = !config.colorNeutral;
      await vscode.workspace
        .getConfiguration("marketlens")
        .update("colorNeutral", next, vscode.ConfigurationTarget.Global);
      emitStatusMessage(
        statusBar,
        next ? "$(paintcan) MarketLens: 颜色脱敏已开启 (无红绿视觉刺激)" : "$(paintcan) MarketLens: 颜色脱敏已关闭 (恢复红绿涨跌)",
        2500
      );
    }),

    // 自定义快捷键
    vscode.commands.registerCommand("marketlens.openKeybindings", async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openGlobalKeybindings",
        "marketlens"
      );
    }),

    // 添加自选（带实时严格校验）
    vscode.commands.registerCommand("marketlens.addItem", async () => {
      if (shouldBlockNodeCommand(statusBar.isBossKeyActive(), readConfig().maskMode, false)) {
        logger.info("专注/简洁展示模式激活期间拒绝添加自选标的（老板键/打码守卫已生效）");
        return;
      }
      await watchlistOps.addItem();
    }),

    // 置顶标的（点击图钉图标或命令触发）
    vscode.commands.registerCommand(
      "marketlens.pinToTop",
      async (node?: StockItem) => {
        // 老板键激活期间一票否决；简洁展示模式下仅在无 node 分支（命令面板触发会弹出含真实名称+代码的 QuickPick）时静默拒绝。
        if (shouldBlockNodeCommand(statusBar.isBossKeyActive(), readConfig().maskMode, Boolean(node))) {
          logger.info("专注/简洁展示模式激活期间拒绝置顶标的（老板键/打码守卫已生效）");
          return;
        }
        await watchlistOps.pinToTop(node);
      }
    ),

    // 删除自选（点击垃圾桶图标或命令触发）
    vscode.commands.registerCommand(
      "marketlens.removeItem",
      async (node?: StockItem) => {
        if (shouldBlockNodeCommand(statusBar.isBossKeyActive(), readConfig().maskMode, Boolean(node))) {
          logger.info("专注/简洁展示模式激活期间拒绝删除自选（老板键/打码守卫已生效）");
          return;
        }
        await watchlistOps.removeItem(node);
      }
    ),

    // 恢复出厂默认设置
    vscode.commands.registerCommand("marketlens.restoreDefaults", async () => {
      await SettingsWebviewPanel.restoreDefaults();
    }),

    // 一键清空自选
    vscode.commands.registerCommand("marketlens.clearWatchlist", async () => {
      await SettingsWebviewPanel.clearWatchlist();
    }),

    // 导出配置备份（JSON 文件）
    vscode.commands.registerCommand("marketlens.exportSettings", async () => {
      await SettingsWebviewPanel.exportSettings(context.globalState);
    }),

    // 导入配置恢复（JSON 文件）
    vscode.commands.registerCommand("marketlens.importSettings", async () => {
      await SettingsWebviewPanel.importSettings(context.globalState);
    }),

    // 设置价格预警（右键菜单或命令面板触发）
    vscode.commands.registerCommand(
      "marketlens.setAlert",
      async (node?: StockItem) => {
        if (shouldBlockNodeCommand(statusBar.isBossKeyActive(), readConfig().maskMode, Boolean(node))) {
          logger.info("专注/简洁展示模式激活期间拒绝设置预警（老板键/打码守卫已生效）");
          return;
        }
        await watchlistOps.setAlert(node);
      }
    ),

    // 设置持仓成本与数量 (F1: Cost & PnL)
    vscode.commands.registerCommand(
      "marketlens.setHolding",
      async (node?: StockItem) => {
        if (shouldBlockNodeCommand(statusBar.isBossKeyActive(), readConfig().maskMode, Boolean(node))) {
          logger.info("专注/简洁展示模式激活期间拒绝设置持仓（老板键/打码守卫已生效）");
          return;
        }
        await watchlistOps.setHolding(node);
      }
    ),

    // 一键添加常用核心大盘指数 (F2: Core Indices)
    vscode.commands.registerCommand(
      "marketlens.addCommonIndices",
      async () => {
        if (!canEmitUserFeedback(statusBar.isBossKeyActive())) {
          logger.info("专注模式激活期间拒绝添加大盘指数（老板键守卫已生效）");
          return;
        }
        await watchlistOps.addCommonIndices();
      }
    ),

    // 查看运行日志（OutputChannel）
    vscode.commands.registerCommand("marketlens.showLogs", () => {
      // 老板键守卫：诊断日志中包含真实标的代码与行情数值（服务请求/预警记录），
      // 专注模式激活期间打开等同于自曝关注范围。
      // 与 openSettings 保持同一策略——失败安全地拒绝，而非先解除隐身
      // （后者会把侧边栏与状态栏的真实行情一并带回，隐蔽性反而更差）。
      if (!canEmitUserFeedback(statusBar.isBossKeyActive())) {
        logger.info("专注模式激活期间拒绝打开运行日志（老板键守卫已生效）");
        return;
      }
      logger.show();
    }),

    // 复制标的代码 / 合约地址（支持 Tooltip 卡片一键复制链接与右键菜单统一复用）
    vscode.commands.registerCommand(
      "marketlens.copyCode",
      async (target?: string | StockItem) => {
        let textToCopy = "";
        let label = "标的代码";

        if (typeof target === "string") {
          textToCopy = target.trim();
          if (textToCopy.startsWith("0x") || textToCopy.length > 30) {
            label = "合约地址";
          }
        } else if (target && typeof target === "object") {
          // 右键菜单传入 StockItem
          const isAlpha =
            target.item?.type === "ALPHA_TOKEN" ||
            target.item?.type === "BSC_TOKEN" ||
            target.item?.chain !== undefined;
          if (isAlpha) {
            textToCopy = target.item?.id || target.confSymbol || "";
            label = "合约地址";
          } else {
            textToCopy = target.item?.symbol || target.confSymbol || "";
            label = "标的代码";
          }
        }

        if (!textToCopy) {
          return;
        }

        await vscode.env.clipboard.writeText(textToCopy);
        emitStatusMessage(statusBar, `$(clippy) 已复制${label}: ${textToCopy}`, 2500);

        // 1. 立即触发树视图轻量变更，使 VS Code 主动销毁/收起当前的 Hover 浮层，彻底根除停留的蓝色 focus 边框
        try {
          treeProvider.notifyChange();
        } catch (err) {
          logger.debug("[copyCode] notifyChange failed", err);
        }

        // 2. 转移焦点至自选侧边栏，确保焦点回归正常上下文
        try {
          await vscode.commands.executeCommand("marketlens.watchlist.focus");
        } catch (err) {
          logger.debug("[copyCode] focus watchlist failed", err);
        }
      }
    )
  );
}

function formatSortModeLabel(mode: import("../types").GroupSortMode): string {
  switch (mode) {
    case "changeDesc":
      return "按涨幅从高到低";
    case "changeAsc":
      return "按跌幅从低到高";
    case "nameAsc":
      return "按名称拼音排序";
    case "priceDesc":
      return "按现价从高到低";
    default:
      return "默认顺序 (手动排列)";
  }
}

