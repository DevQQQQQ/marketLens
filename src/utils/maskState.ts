// src/utils/maskState.ts

/**
 * 判定当前自选列表及视图是否应当打码脱敏
 *
 * 核心安全规则：
 * 1. 只要老板键（Boss Key）处于激活状态，无论用户个人设置的 maskMode 为何值，视图一律强制打码脱敏；
 * 2. 仅在未激活老板键的常规状态下，视图才遵循用户自定义的 maskMode（摸鱼伪装模式）。
 *
 * @param bossKeyActive 老板键是否激活中
 * @param userMaskMode  用户配置的摸鱼打码开关 (config.maskMode)
 */
export function isDisplayMasked(bossKeyActive: boolean, userMaskMode: boolean): boolean {
  return Boolean(bossKeyActive || userMaskMode);
}

/**
 * 判定命令入口（pinToTop / removeItem / setAlert）是否应因脱敏而拒绝执行
 *
 * 核心安全规则：
 * 1. 老板键激活期间：一票否决全部操作，全系统保持完全隐蔽静默；
 * 2. 简洁展示模式（maskMode）开启期间：
 *    - 若无 node 节点（从 VS Code 命令面板 Ctrl+Shift+P 唤起），会弹出包含所有自选真实名称/代码的 QuickPick，必须静默拒绝防自曝；
 *    - 若携带 node 节点（用户在侧边栏树视图上右键点击或点击 inline 按钮），放行以保障正常交互功能。
 *
 * @param bossKeyActive 老板键是否激活中
 * @param userMaskMode  用户配置的摸鱼打码开关
 * @param hasNode       是否传入了树节点上下文（右键/inline 按钮触发）
 */
export function shouldBlockNodeCommand(bossKeyActive: boolean, userMaskMode: boolean, hasNode: boolean): boolean {
  if (bossKeyActive) {
    return true;
  }
  return !hasNode && userMaskMode;
}

/**
 * 判定「用户主动重新打开自选看板」时，是否应当自动解除老板键（专注模式）隐身状态
 *
 * 核心安全规则与设计动机：
 * 1. 老板键状态仅存于内存（statusBar.bossKeyActive），且在重构前只由 Alt+M 命令复位；
 *    若用户手动重新打开侧边栏，bossKeyActive 会持续一票否决 maskMode，
 *    导致「切换简洁展示模式 (Alt+K)」静默失效——界面永久停留在脱敏态且无任何提示反馈。
 * 2. 语义约定：用户主动打开看板 = 明确要查看行情 = 专注模式的自然出口。
 * 3. 该判定必须同时满足「视图可见」与「老板键激活」两个前提，
 *    严禁在视图不可见（visible === false）时解除，避免误触发导致行情意外暴露。
 *
 * @param viewVisible   自选看板视图是否处于可见状态（treeView.onDidChangeVisibility）
 * @param bossKeyActive 老板键当前是否处于激活状态
 */
export function shouldAutoExitBossKey(viewVisible: boolean, bossKeyActive: boolean): boolean {
  return Boolean(viewVisible && bossKeyActive);
}

/**
 * 判定当前是否允许向用户回显任何 UI 反馈（状态栏临时消息、信息提示、面板唤起等）
 *
 * 核心安全规则：老板键（专注模式）激活期间必须完全静默。
 *
 * 设计动机：
 * `vscode.window.setStatusBarMessage` 与 `showInformationMessage` 均独立于
 * `StatusBar` 自身的 `barItem.hide()` 逻辑——即便行情条已隐藏，临时消息依然会在
 * 状态栏区域闪现。其中「MarketLens 已隐蔽」这类提示本身就是最显眼的暴露源，
 * 会直接瓦解老板键的隐身初衷。因此所有面向用户的回显统一经由本判定收口。
 *
 * @param bossKeyActive 老板键是否激活中
 */
export function canEmitUserFeedback(bossKeyActive: boolean): boolean {
  return !bossKeyActive;
}

/**
 * 简洁展示模式开关（`Alt + K`）的实际语义决议结果
 */
export interface MaskTogglePlan {
  /** 是否需先解除老板键（专注模式）隐身状态 */
  exitBossKey: boolean;
  /** 本次操作结束后 maskMode 的目标值 */
  nextMaskMode: boolean;
  /** 是否需要将目标值落盘（仅当与当前值不同时写入，避免无谓的配置变更事件与树重建） */
  requiresConfigWrite: boolean;
}

/**
 * 决议「简洁展示模式开关」在老板键激活状态下的真实语义
 *
 * 设计动机：
 * `isDisplayMasked` 规定老板键一票否决 maskMode。因此在老板键激活期间单纯翻转
 * 并落盘 maskMode 不会带来任何可见变化，只会造成「配置已改、观感未变」的静默失效
 * （用户按下 `Alt + K` 后界面依旧全部脱敏，且无任何提示反馈）。
 *
 * 语义约定：
 * 1. 常规态：保持纯粹的取反语义，与历史行为完全一致；
 * 2. 老板键激活期：视为「我要看真实数据」——直接解除专注模式，并把 maskMode 归零，
 *    保证操作结果与用户意图一致；此时仅在 maskMode 原为 true 时才需要落盘。
 *
 * @param bossKeyActive    老板键当前是否处于激活状态
 * @param currentMaskMode  配置中当前的 maskMode 值
 */
export function resolveMaskToggle(bossKeyActive: boolean, currentMaskMode: boolean): MaskTogglePlan {
  if (bossKeyActive) {
    return {
      exitBossKey: true,
      nextMaskMode: false,
      requiresConfigWrite: currentMaskMode,
    };
  }
  return {
    exitBossKey: false,
    nextMaskMode: !currentMaskMode,
    requiresConfigWrite: true,
  };
}

/**
 * 简洁展示模式下自选列表标的节点的脱敏 Tooltip 静态提示。
 *
 * 安全约束：占位文案**不得含插件名、模式名与快捷键**——伪装态下鼠标无意悬停即会读出
 * 「MarketLens / 简洁展示模式 / Alt+K」这类自曝信息，与文本打码同等重要（AGENTS.md §5.4）。
 */
export const MASKED_TOOLTIP_TEXT = "****";

/**
 * 决议自选列表节点的 Tooltip 内容与展示策略
 *
 * 核心安全规则与设计动机：
 * 1. 简洁展示模式 (maskMode / isDisplayMasked) 开启时，侧边栏标的行情数据已被替换为打码占位符；
 * 2. 若继续向节点赋予包含开高低收、涨跌额、成交量额、预警阈值与真实代码名称的 Markdown 卡片，
 *    用户鼠标无意悬停即会全量暴露敏感财务数据，致使脱敏形同虚设；
 * 3. 必须在脱敏态下一票否决 Markdown 详情卡片，强制收敛为无害的静态纯文本提示（与状态栏保持同等安全防线）；
 * 4. 采用回调函数惰性求值：脱敏态下完全跳过卡片文本拼接、数值格式化与对象创建，提升轮询刷新性能。
 *
 * @param masked 是否处于脱敏状态 (isDisplayMasked)
 * @param cardBuilder 生成常规详情卡片的回调函数（仅在非脱敏态下执行）
 */
export function resolveStockTooltip<T>(
  masked: boolean,
  cardBuilder: () => T
): string | T {
  if (masked) {
    return MASKED_TOOLTIP_TEXT;
  }
  return cardBuilder();
}
