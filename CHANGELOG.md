# Changelog / 更新日志

All notable changes to the "MarketLens" extension will be documented in this file.  
本项目的所有重要版本更新与改动记录均将在此文档中呈现。

## [Unreleased]

## [1.2.4] - 2026-10-08

<details>
<summary><b>⚡ 网络探活性能飞跃、类型定义基线加固与测试质量守卫 (Performance & Quality Hardening)</b></summary>

- **⚡ 代理回退前置探活与冷 miss 毫秒级熔断**：
    - 代理模式回退链前置 600ms 轻量 HEAD 探活（`testLocalPort`），未启动代理时瞬间跳过无效端口，将冷 miss 探测耗时由 22 秒骤降至毫秒级，彻底消除首次刷新与无代理环境下的界面冻结；
    - 缩短端口请求超时至 1500ms，完善 30s 冷却熔断与并发重试拦截。
- **🔒 VS Code API 类型契约精确锁定**：
    - 精确锁定 `@types/vscode` 为 `~1.85.0`，消除编译期类型远新于宿主下限（1.85.0）导致的低版本兼容性隐患。
- **🧪 单元测试网健全与假绿修复**：
    - 修复测试中派发错误命令 ID（`toggleMaskMode` → `toggleMask`）导致的虚假测试防护，补全对摸鱼打码模式状态翻转的断言；
    - 针对 `smartNetworkGet` 代理回退链、`BinanceService` 异常降级及 `DexScreenerService` 数据映射与黑名单清理扩充测试用例，全仓用例增至 83 项，网络核心模块行覆盖率大幅提升。
- **🧹 魔法数字与静态展示合规治理**：
    - 统一收敛代理端口魔法数字，全面复用 `DEFAULT_PROXY_PORT` 与 `DEFAULT_PROXY_URL` 常量；
    - 纠偏展示页功能描述，接入发版版本号全自动同频机制。
</details>

## [1.2.3] - 2026-09-30

<details>
<summary><b>📊 深度行情指标扩展、一键复制与轻量交互体验升级 (Depth Metrics & UX Polish)</b></summary>

- **📊 A 股深度量价与估值指标扩展**：
    - 深度映射腾讯行情接口潜能，新增换手率、量比、振幅、日内均价、涨跌停价、市盈率 (TTM)、市净率 (PB)、流通市值与总市值 10 项核心维度；
    - 悬停卡片采用“成对紧凑排版”布局（最高/最低、今开/昨收、均价/振幅、换手/量比、涨停/跌停、市盈/市净、流通/总市值），在信息密度翻倍的同时卡片高度缩减近 50%；
    - 大数值格式化全面支持万亿（`1e12`）阶梯呈现；对大盘指数自动过滤 `-1` 与 `0.00` 脏数据。
- **📋 标的代码与合约地址一键复制交互**：
    - 悬停卡片内嵌小巧安全的 `[📋 复制]` 交互链接（受 `md.isTrusted` 精准白名单保护）；
    - 点击复制时触发树视图轻量更新，立即销毁收起当前 Hover 浮层，彻底根除浏览器/VS Code 原生 `:focus` 蓝色边框残留；
    - 侧边栏标的节点同步挂载右键菜单项 `📋 复制标的代码 / 合约地址`，提供双通道零边框复制保障；
    - 标的代码与合约地址保持标准反引号代码块包裹，鼠标移入卡片后双击文本按 `Ctrl+C` 亦可原生复制。
- **🔕 自选管理轻量无感反馈**：
    - 添加标的、删除标的、置顶标的与清除/设置预警成功提示统一由系统级 Toast 弹窗升级为 VS Code 原生状态栏提示（`setStatusBarMessage`）；
    - 操作完成后于状态栏轻量提示，3 秒后自动平滑淡出，彻底告别左下角/右下角常驻弹窗遮挡代码的问题。
- **🌐 仓库重命名与全局链接一致性**：
    - 全仓统一 GitHub 仓库名为 `https://github.com/DevQQQQQ/marketLens`。
</details>

## [1.2.2] - 2026-09-28

<details>
<summary><b>🛡️ 稳定性加固、防窥脱敏与工程全链路质量守卫 (Hardening & Quality Assurance)</b></summary>

- **🛡️ 脏自选标的全局清洗与空指针防御 (P1-A)**：
    - 在 `readConfig()` 唯一读取出口挂载 `sanitizeWatchlist` 抽象，全量清洗非法 `null`、空对象及无效代码结构，阻断手工编辑 `settings.json`、旧版本残留与第三方同步导致的 5 处 `TypeError` 树视图白屏隐患；
    - 纵深加固 `watchlistProvider`、`symbolHelper` 与 `watchlistOps`，消除跨分组与拖拽重排边界空指针。
- **🌐 备份导入代理持久化修复 (P2-B)**：
    - 修复从备份 JSON 恢复配置时漏写 `proxyPort` 与全局 `proxyUrl` 导致静默读取系统代理环境变量的问题，补齐写盘与单元测试断言。
- **🕶️ 防肩窥脱敏与命令守卫闭环 (P2-C / P3)**：
    - 在 `addItem`（添加标的）与 `sortGroup`（分组排序）无上下文节点入口增加 `shouldBlockNodeCommand` 守卫，杜绝从命令面板呼出 QuickPick 导致自选代码被近身偷窥；
    - 在 `showLogs` 命令中增加 `maskMode` 拦截；设置面板价格预警表格增加 `maskMode` 实时遮罩渲染；
    - 状态栏连接 Tooltip 移除明文端口展示；Webview Nonce 改用加密强随机数生成（CWE-338 防御）。
- **🧪 架构接线层测试网与 CI 质量门禁加固**：
    - 引入零外部依赖轻量 mock 环境（`scripts/setup-mock-vscode.js`），全仓统一规范化显式 `.ts` 扩展名，使 `config`、`backupHelper`、`statusBar`、`watchlistOps`、`watchlistProvider`、`scheduler` 等全部接线模块接入原生回归测试网；
    - 单元测试增至 78 项，核心工具覆盖率超 92%，项目总行覆盖率稳步跃升至 **83%+**；
    - CI 流水线接入依赖安全审计门禁并补齐 `pretest:coverage` 自动化守卫。
</details>

## [1.2.1] - 2026-09-24

<details>
<summary><b>🐛 缺陷修复与交互安全 (Bug Fixes & UX Hardening)</b></summary>

- **🛡️ 简洁展示模式（摸鱼模式）右键命令交互解阻**：
    - 修复此前开启简洁展示模式（`Alt + K`）后，在自选树视图上右键点击“置顶标的”、“删除自选”或“设置预警”时被守卫误拦截、导致右键菜单失灵的问题；
    - 新增 `shouldBlockNodeCommand` 守卫判定（`src/utils/maskState.ts`）：精准区分老板键（一票否决全量操作）与简洁模式（仅在从 VS Code 命令面板唤起无 node 节点时拦截 QuickPick 弹窗以防标的自曝，右键传入 node 时放行）。
- **📦 配置备份导入清洗与资产类型智能推导**：
    - 修复导入配置备份（JSON）时，若缺少 `type` 字段或存在纯字符串标的会被一律硬编码写死为 `"A_SHARE"` 的严重缺陷；
    - 接入 `resolveItemAssetType` 结合代码绝对强特征与所属分组名动态推导正确的市场板块（美股为 `US_STOCK`、港股为 `HK_STOCK`、加密货币为 `CRYPTO`），杜绝跨板块串味导致轮询无数据。
- **🕶️ 状态栏摸鱼伪装防覆盖守卫**：
    - 修复在简洁展示模式下点击右下角预警通知的【静音 15 分钟】按钮时，状态栏消息会短暂覆盖 Git 分支伪装文本的问题。
- **⚡ 配置变更异常防御**：
    - 为 `flushConfigChange` 增加全局异常捕获，防止脏配置落盘或时序异常阻塞后续行情轮询。
- **🧪 单元测试体系扩充**：
    - 单元测试增至 68 项，补充命令面板/右键菜单守卫真值表与纯字符串标的指纹提取校验。
</details>

## [1.2.0] - 2026-09-22

<details>
<summary><b>✨ 新增功能 (Features)</b></summary>

- **📤 自选标的与配置一键导出备份 (JSON)**：
    - 支持一键将当前全部自选标的列表（基金/A股/港股/美股/Binance/Alpha）、自定义分组、手动拖拽顺序、价格预警规则及全局个性化偏好导出为标准 `.json` 文件；
    - 解决了跨电脑换机、设备重装、企业内网无账号环境无法使用 VS Code 云同步的迁移痛点；同时支持将优质自选组合一键分享给好友。
- **📥 自选标的与配置一键导入恢复 (JSON)**：
    - 支持从备份 `.json` 文件一键恢复全部自选标的与设置，具备 Schema 数据合法性校验与弹窗数量确认，防止误操作；
    - 写入后无需重启 VS Code，侧边栏看板、状态栏与设置面板即时 0 延迟渲染刷新。
- **🎮 双通道交互支持**：
    - **命令面板快捷指令**：新增 `marketlens.exportSettings`（导出配置备份）与 `marketlens.importSettings`（导入配置恢复）；
    - **设置面板专属卡片**：通用设置面板中直观提供【📤 导出配置备份】与【📥 导入配置恢复】操作按钮。

</details>

<details>
<summary><b>🚀 优化改进与文档对齐 (Improvements & Documentation)</b></summary>

- **Open VSX 网页展示优化**：
    - 国际化默认语言包采用“核心中文在前 + 简明英文在后”双拼策略，解决 VSX 网页端无法动态切换语言的问题，国内开发者在 VSX 官网检索可直接清晰展示中文卡片；
    - `package.json` 保持严格的 `%displayName%` / `%description%` 占位符契约，保障海外用户多语言分发与单元测试自洽。
- **调度逻辑与 JSDoc 注释对齐**：
    - 更新 `extractStatusBarQuotes` JSDoc，如实对齐休市管理（`autoCollapseClosedGroups`）下已闭市标的动态剔除与全休市静默隐藏的真实业务契约。
- **单元测试体系扩充**：
    - 单元测试全量升级至 67 项，新增配置导出与导入校验契约测试，覆盖标准包装、平铺结构及非法数据防御。

</details>

## [1.1.11] - 2026-09-22

<details>
<summary><b>🛡️ 防泄露加固、休市日历校准与国际化优化</b></summary>

- **🛡️ 简洁展示模式（摸鱼打码）侧边栏悬停信息防泄露**：
    - 修复此前开启简洁展示模式（`Alt + K`）后，列表项虽显示 `****` 打码，但鼠标悬停在自选标的上仍会弹出包含真实标的名称、代码、开高低收、涨跌额、成交量额与预警阈值的 Markdown 详情卡片问题；
    - 新增 `resolveStockTooltip(masked, cardBuilder)` 语义决议函数（`src/utils/maskState.ts`）：在脱敏态下强制一票否决全部 Markdown 财务指标卡片，收敛为无害静态纯文本提示 `"MarketLens — 简洁展示模式 (Alt+K 切换)"`（与状态栏伪装模式保持同等安全防线）；
    - 引入回调函数惰性求值：脱敏态下完全跳过卡片文本拼接、数值格式化与对象创建，提升轮询刷新性能与内存表现。
- **📅 港股 2026 年法定休市日历精准校准**：
    - 对照香港政府宪报（Cap. 149）与港交所（HKEX）交易日历完成全量校准；
    - **补全顺延补假**：追加 `2026-04-07`（清明节适逢周日顺延周一，与复活节星期一重叠顺延至周二增补公众假期，港交所全天休市）；
    - **消除误判休市隐患**：彻底剔除 `2026-12-28` 错误休市标记（2026 圣诞节后首日落在周六，周一不补休，港交所正常开市），杜绝 3 个月后港股全天被静默误判休市而停止轮询并折叠的严重隐患；
    - **清理周末冗余**：剔除 `2026-09-26`（周六）冗余项，日历收敛为纯正的 14 个平日交易日休市集；
    - 追加港股年度平日休市总数守护单测与周末日期防污染过滤守卫。
- **📖 调度逻辑与 JSDoc 注释对齐**：
    - 更新 `extractStatusBarQuotes` JSDoc，如实对齐休市管理（`autoCollapseClosedGroups`）下已闭市标的动态剔除与全休市静默隐藏的真实业务契约，消除文档债误导风险。
- **🌐 扩展元数据与国际化文案优化**：
    - 对齐中英文主标题与描述文案，强化 A股/港股/美股/基金/加密货币/DEX 资产覆盖与摸鱼盯盘核心效率特性；
    - 保持双语 NLS 占位符契约完全自洽，CI 质量门禁 100% 绿灯。

</details>

## [1.1.10] - 2026-09-21

<details>
<summary><b>🕶️ 老板键守卫、入口语义统一与国际化补齐</b></summary>

- **🕶️ 老板键（专注模式）自动解除**：
    - 新增 `shouldAutoExitBossKey(viewVisible, bossKeyActive)` 语义判定（`src/utils/maskState.ts`）：专注模式激活期间，用户重新打开自选看板（点击活动栏 MarketLens 图标，或任何使视图由隐藏转为可见的操作）即自动退出专注模式并恢复真实行情；
    - 修复根因：`isDisplayMasked` 对 `bossKeyActive` 执行一票否决（`bossKeyActive || userMaskMode`），而 `bossKeyActive` 原先仅能由 `Alt + M` 复位且全程仅存内存，导致专注模式期间按下 `Alt + K` 时配置虽已变更、界面却持续被覆盖，呈现「点了没反应」且无任何报错的静默失效；
    - 安全边界：视图不可见时严格不解除，规避窗口重载与布局切换引发的误触发；`Alt + M` 的既有恢复链路行为完全不变。
- **🕶️ 老板键（专注模式）全链路静默守卫**：
    - 新增 `canEmitUserFeedback(bossKeyActive)` 语义判定（`src/utils/maskState.ts`），统一收口所有面向用户的回显通道；
    - 修复专注模式激活期间仍会弹出「MarketLens 已隐蔽」状态栏提示的隐蔽性泄漏——`vscode.window.setStatusBarMessage` 独立于 `StatusBar.barItem.hide()`，行情条虽已隐藏，该提示仍会在状态栏区域闪现，反而成为最扎眼的暴露源；现改为仅写入 OutputChannel 日志；
    - 新增 `marketlens.openSettings` 老板键守卫：专注模式期间静默拒绝打开设置面板（该面板会完整列出全部自选标的名称），且不解除隐身状态、不弹出任何提示，需要查看行情时请点击活动栏图标（自动解除专注模式）或再次按下老板键；
    - 同步加固「排序方式」切换提示与「颜色脱敏」切换提示，专注模式期间一律静默；退出专注模式后的恢复提示（`Alt + M`）保持原有行为不变。
- **🎯 专注模式与简洁展示模式的入口语义统一（补全）**：
    - 新增 `resolveMaskToggle(bossKeyActive, currentMaskMode)` 语义决议（`src/utils/maskState.ts`）：老板键激活期间按下 `Alt + K` 不再静默失效，而是先自动退出专注模式、再将 `maskMode` 归零，确保「我要看真实数据」的意图被完整满足；仅在 `maskMode` 原为 `true` 时才落盘，避免无谓的配置变更事件与树重建；
    - 常规态下 `Alt + K` 保持纯粹的取反语义，与历史行为完全一致；
    - 同步对齐设置面板入口：经面板修改「简洁展示模式」时若老板键仍处于激活态，先自动解除专注模式再应用，杜绝同一缺陷的第二个入口出现「配置已改、观感未变」；
    - 兼容性：`Alt + K` / `Ctrl + Alt + K` 键位、全部配置 key 与命令 ID 均保持不变，老用户已持久化的 `settings.json` 继续完全有效。
- **📖 文档与文案对齐**：
    - `README.md` / `README.en.md` 补充专注模式静默行为与 `Alt + K` 语义说明；
    - 设置面板「伪装摸鱼模式」卡片描述补充左侧自选列表的 `****` 遮罩行为（此前仅声明作用于状态栏，与实现不符），快捷键提示卡同步补充专注模式说明；
    - `package.json` 中 `marketlens.maskMode` 的配置描述修订为「简洁展示模式：将底部状态栏与左侧自选列表的行情数据打码为简洁构建信息格式」。
- **🛡️ 运行日志面板纳入老板键守卫**：
    - `marketlens.showLogs` 补齐与设置面板一致的专注模式守卫：诊断日志中包含真实标的代码与行情数值，专注模式激活期间静默拒绝打开，且不解除隐身状态、不弹出任何提示。
- **🔧 调度器停用后的定时器泄漏修复**：
    - `RefreshScheduler` 新增 `disposed` 终止标志。此前 `dispose()` 仅调用 `stop()` 清理当前定时器，若此刻恰有一次刷新在飞行中，其 `finally` 分支会重新挂出一个不再受 `stop()` 管辖的定时器，导致扩展停用后仍在后台周期性发起网络请求，直至 VS Code 进程退出；现 `dispose()` 先置位终止标志、`refresh()` 与 `scheduleNextTick()` 统一早退，`start()` 对称复位以支持「停用后重新启用」的合法路径。
- **🌐 国际化补齐（配置描述与顶层元信息）**：
    - `package.json` 中 **41 项**配置项的 `description` 由中文字面量改为 `%key%` 占位符，并同步补齐 `package.nls.json`（英文）与 `package.nls.zh-cn.json`（中文）双语翻译，修复此前非中文环境下设置页 41 条说明全为中文的问题；
    - 顶层 `displayName` / `description` 接线到 NLS，激活此前「定义即死」的两个英文键，Marketplace 与扩展列表在英文环境不再显示中文；
    - 移除无对应命令声明的死键 `command.clearAllAlerts`（该功能实际经 Webview 消息通道实现，从未注册为 VS Code 命令）；
    - 兼容性：仅改写描述性文案，全部配置 key、默认值、`order`、枚举定义与命令 ID 零改动，老用户已持久化的 `settings.json` 继续完全有效。
- **📖 脚本注释与文档数字校正**：
    - `scripts/sync-readme-en.js` 头注释重写为与实现严格一致（此前仍宣称「采用公共免鉴权并发批量翻译服务」，实际早已是纯离线脚本，会误导后续维护者）；如实标注 `GLOSSARY_MAP` / `protectMarkdown` / `restoreMarkdown` 等导出仅为单测契约保留、生产路径无调用方；
    - `RELEASE.md` 的 `.vsix` 体积说明由「约 140KB」校正为「约 150KB」（实测 1.1.9 产物为 153.3KB）。
- **🧪 单元测试体系扩充**：
    - 新增「专注模式静默守卫」与「`Alt + K` 语义决议」真值表及交叉时序用例；
    - 新增「`package.json` 占位符与语言包契约一致性」防回归用例（校验双语言包键集合一致、占位符全部可解析、无孤儿死键、配置描述与命令标题必须走 NLS）；
    - 核心单测扩充至 **65 例**，全部 100% PASS。

</details>

## [1.1.9] - 2026-09-20

<details>
<summary><b>🚀 视图操作优化、休市折叠记忆与状态自愈</b></summary>

- **🚀 视图操作优化（全部展开）**：自选列表标题栏新增「全部展开」按钮（`marketlens.expandAllGroups`），与 VS Code 内置的「全部折叠」成对配对，支持一键展开全部分类看板；
- **🛡️ 休市折叠记忆隔离机制**：重构分组节点 ID 生成逻辑（`buildGroupNodeId`），引入基于激活标识与视图显示递增的会话标识（`collapseSessionTag`），彻底规避 VS Code 优先恢复用户上次手动展开状态导致的「休市默认折叠」失效问题；
- **⚡ 交互体验与状态自愈**：侧边栏由隐藏转为可见时自动开启新折叠会话并唤醒行情刷新；用户点击「全部展开」时支持临时覆盖休市折叠，直至下一次重新打开视图时自愈复位；
- **🔧 设置面板字符转义修复**：加固 `src/ui/settingsHtml.ts` 中 `activeKey` 针对反斜杠字符的正则表达式转义，提升包含特殊字符代码时的 DOM 节点选择健壮性；
- **🧪 单元测试体系扩充**：新增针对 `buildGroupNodeId` 会话隔离机制与展开覆盖的专项单测，核心测试用例扩充至 **61 例**，全部 100% PASS。

</details>

## [1.1.8] - 2026-09-18

<details>
<summary><b>🧪 测试扩充、国际化加固与代理容错</b></summary>

- **🧪 单元测试体系扩充**：新增 Markdown 翻译隔离与休市自动折叠单测，全项目核心单测扩充至 **60 例**，全部 100% PASS；
- **🌐 国际化与本地化加固**：全面规范 `package.json` 的 NLS 占位符引用，补齐 `package.nls.zh-cn.json` 与 `package.nls.json`，纯离线重构 `README.en.md` 同步脚本；
- **🛡️ 代理与网络配置容错**：修复设置面板端口失焦导致自定义非本地代理 host 丢失的问题，加固端口探测与直连兜底逻辑；
- **🔔 预警管理器孤儿规则清理**：自选标的删除后自动关联清理预警规则，消除配置与内存冗余。

</details>

## [1.1.7] - 2026-09-17

<details>
<summary><b>🏛️ 架构重构、配置扇出与测试覆盖率升级</b></summary>

### 🚀 架构重构与核心优化 (Architecture & Improvements)

- **🏛️ 腾讯行情基类抽象收敛 (`TencentBaseService`)**：
    - 抽取 A股、港股、美股统一底层行情基类 `TencentBaseService`，消除多市场间大段重复的网络请求、报文切片与异常处理逻辑；
    - 规范化请求生命周期与错误捕获，提升代码可维护性与扩展性。
- **⚙️ 全板块配置扇出与状态栏联动加固 (`config.ts`)**：
    - 引入 `MARKET_SECTIONS` 作为全量子市场唯一事实源，统一代理（`proxyUrl` / `proxyPort`）与状态栏（`statusBar`）的全板块扇出持久化；
    - 加固 `recomputeStatusBarEnabled` 聚合状态判定与 `affectsNetworkConfig` 敏感配置监听，杜绝子板块漏配导致的配置漂移。
- **🧪 单元测试体系与 CI 覆盖率全面升级**：
    - 新增 `test/config.test.ts` 专项测试，全项目核心单测扩充至 **58 例**，全部 100% PASS；
    - CI 流水线引入 `npm run test:coverage`，核心业务模块测试覆盖率达 **87.57%**。

</details>

---

## [1.1.6] - 2026-09-16

<details>
<summary><b>📈 基金独立配置、分组排序与代码解析加固</b></summary>

### 🚀 新增特性与核心优化 (New Features & Improvements)

- **📈 基金板块独立配置中心与全链路管理**：
    - 配置中心（Settings Webview）新增独立的「📈 基金板块」导航与配置面板；
    - 支持基金板块独立开关（`marketlens.fund.enabled`）、底部状态栏轮播（`marketlens.fund.statusBar`）、休市暂停轮询（`marketlens.fund.stopOnMarketClosed`）及直连/代理网络设置；
    - 状态栏轮播与标的分桶抓取全面支持基金与 A 股独立启闭，彻底解耦。
- **📊 分组独立排序与手动重排自洽协同**：
    - 完善各资产分组（基金、A股、港股、美股、Binance、Alpha）的独立排序记忆机制；
    - 修复动态排序模式下执行手动拖拽重排时无缝切回默认顺序的交互逻辑。
- **🛡️ 标的代码解析与 ETF 交易所前缀推断加固**：
    - 增强 A 股与场内 ETF 代码前缀推断算法，彻底杜绝特定 ETF / 债券代码被误判为北交所的前缀偏差。

</details>

---

## [1.1.5] - 2026-09-12

<details>
<summary><b>🎨 配色切换、节假日日历与全链路缺陷修复</b></summary>

### 🚀 新增特性与核心优化 (New Features & Improvements)

- **🎨 涨跌配色方案自由切换 (Color Scheme)**：
    - 新增 `marketlens.colorScheme` 设置项，支持国际习惯 `greenUpRedDown`（绿涨红跌，默认）与国内传统习惯 `redUpGreenDown`（红涨绿跌）；
    - 切换配色方案时自动联动关闭 `colorNeutral` 颜色脱敏模式，并在左侧侧边栏与底部状态栏毫秒级双向同频。
- **📅 交易时段法定节假日日历与休市自适应降频**：
    - 内置 2024~2027 年 A股、港股、美股法定节假日离线日历，彻底杜绝假日期间误判开盘；
    - 休市自适应降频：在法定节假日、闭市或长时间无行情变动时，轮询间隔自适应降频至 60s~120s，显著降低网络与 CPU 消耗。
- **🌐 操作系统环境变量代理自适应回退**：
    - 自适应探测读取 `process.env.HTTPS_PROXY / HTTP_PROXY / ALL_PROXY`，解决局域网软路由（如Clash）或环境变量代理免配置即开即用。
- **🛡️ 大批量自选请求切片保护**：
    - 引入 `chunkArray` 切片并发机制，针对 A股、港股、美股按 40 只/批、Binance 按 50 只/批安全分片，彻底杜绝 HTTP 414 URI Too Long 风险。
- **🔤 原生 0 依赖 GBK 解码三级防御与容错**：
    - 采用单例原生 `decodeGbk`，提供 Full-ICU GBK -> UTF-8 降级 -> Latin-1 单字节映射三级安全保底，行情数字与标的 100% 不丢失、盘面不空白。
- **🧹 代码清洁度与单一事实源收敛 (A1~A4 重构)**：
    - 统一 alerts 预警更新路径并清理死分支；
    - Webview 面板统一复用 `readConfig()` 作为单一事实来源，消除配置漂移风险；
    - 多板块状态栏与代理样板代码封装，去除源码中所有硬编码版本号。

### 🐛 缺陷修复 (Bug Fixes)

- **🇨🇳 A 股交易所前缀推断错误导致 ETF / 债券 / 深市 B 股永久无行情**：
    - 修复原「6/9 开头 → sh，0/3 开头 → sz，其余一律 → bj」的粗暴推断逻辑，该逻辑会将 `510300`（沪深300ETF）、`159915`（创业板ETF）、`200011`（深市B股）、`113050`（沪市可转债）等合法标的错误加上 `bj` 前缀，导致腾讯接口始终返回空、侧边栏永久停留在「获取行情中…」；
    - 新增统一裁决函数 `inferAShareExchange`，按「明确代码段优先 + 首位兜底」两级判定交易所：北交所 `43/83/87/88/92`、沪市 `110/111/113/118/122/019/018/010/020` 债券段与 `5/6/9` 首位、深市 `100/112/123/127/128` 债券段与 `0/1/2/3` 首位；
    - 输入解析端（`inputValidator`）与行情抓取端（`aShareService`）改为共用同一函数，彻底消除两端规则漂移；
    - 新增 3 组回归测试用例（`inferAShareExchange` / `normalizeAShareCode` / `validateAndParseInput` 端到端），单测由 32 例扩充至 35 例。
- **⚡ 设置面板调整预警后 🔔 图标出现瞬时回退**：
    - 修复 Webview「先同步更新内存、后异步落盘」流程中，`rebuildTree()` 内部仍从磁盘 `readConfig()` 读回旧值、导致预警图标与板块开关「对 → 错 → 对」抖动的问题；
    - `RefreshScheduler.rebuildTree()` 新增 `configOverride` 参数，由调用方透传内存中已即时更新的配置。
- **📊 状态栏总控开关显示失真**：
    - 修复「仅关闭 A 股参与轮播」时总控开关被误显示为关闭的问题（原实现取五个板块 `statusBar` 的逻辑与），改用全局 `statusBar.enabled` 语义判定。
- **🛡️ 悬停气泡信任策略收敛**：
    - `MarkdownString.isTrusted` 由 `true` 改为 `{ enabledCommands: [] }`，保留 Markdown 表格渲染的同时禁用全部命令链接，消除第三方数据源（DexScreener 代币名称）注入 `command:` 链接的可执行风险。
- **⛓️ Alpha 链上代币无效/已下架地址 10 分钟临时抑制机制 (Anti-Storm Blacklist)**：
    - 对齐 Binance 架构设计，在 `DexScreenerService` 中引入 `invalidAddresses` 临时黑名单（10 分钟 TTL）与连续失败计数机制；
    - 修复此前对撤池、归零或无效合约地址每轮轮询反复重试两次（切片批查 + 单查补漏）所导致的降级风暴，彻底杜绝触发 DexScreener HTTP 429 速率限制；
    - 手动强制刷新（`marketlens.refresh`）或配置变动时自适应复位黑名单，保证新加池代币即时可查；单测扩充至 36 例。
- **📝 显式暴露诊断日志命令**：
    - 注册 `marketlens.showLogs` 命令（`MarketLens: 查看运行日志`），用户在遇到网络或代理问题时可一键调起 OutputChannel 排查。
- **🧪 腾讯行情报文 Golden Sample 契约测试与三角数学自洽自愈 (Data Sanity Guard)**：
    - 针对 A股、港股、美股解析模块抽离标准 `parseResponse` API，并补齐真实 Golden Sample 报文端到端字段契约单测；
    - 引入三角数学交叉校验：基于 $\text{Price} - \text{PrevClose} \approx \text{ChangeAmt}$ 实时监控字段自洽性，若上游出现异常位移或空值自动发出 `logger.warn` 并触发自愈纠偏，彻底根除“静默解析错值”隐患；单测由 36 例扩充至 37 例。
- **🔄 代理与轮询设置变更消除重复全量刷新 (Deduplicate Network Refreshes)**：
    - 修复在图形化设置面板中修改代理端口/地址、轮询间隔或开启自动刷新时，`onDidUpdateSetting` 与 VS Code 核心配置监听 `onDidChangeConfiguration` 竞态并发触发 `scheduler.start()`，导致 1 秒内产生 2~3 次全量多市场并发打网与重试队列的问题；
    - 收敛调度重启逻辑至 `onDidChangeConfiguration` 单一事实来源，在保持内存即时响应与代理缓存清理的同时，彻底消除并发网络风暴。
- **🛡️ 预警矩阵 Webview XSS 与属性引号逃逸全方位防护 (HTML Injection / CWE-79 Guard)**：
    - 修复 `settingsHtml.ts` 中 `renderAlertTable` 客户端动态拼接 `tbody.innerHTML` 时未转义 `grpName`、`sym`、`name` 及数值字段，可能被不可控的上游链上代币名（DexScreener `baseToken.name`）利用双引号逃逸 `data-*` 属性并注入内联遮罩样式与 HTML 标签的漏洞隐患；
    - 内置标准 `escapeHtml` 实体转义机制，原生防御属性突破与标签注入；单测用例由 37 例扩充至 38 例。
- **🚀 双平台自动化发布与受限工作区信任 (Dual-Platform CI & Workspace Trust)**：
    - CI 流水线（`.github/workflows/release.yml`）补充 VSX Registry 自动化发布（`ovsx publish`），严格践行双平台发布铁律；
    - `package.json` 补充 `capabilities.untrustedWorkspaces: { supported: true }`，在受限制工作区模式下免警告流畅运行；
    - 补充 `package.nls.json` 英文元数据与 `README.en.md` 英文技术文档，提升海外生态曝光。
- **🧹 仓库卫生与打包排除规范 (Packaging Hygiene Guard)**：
    - `.vscodeignore` 严格排除 `docs/**`、`AGENTS.md`、`*.log`、`*.txt` 等内部开发准则与临时文件，杜绝内部 Prompt 与草稿泄露并极致瘦身 VSIX 包；
    - `.gitignore` 补充日志与临时断言文件过滤规则。
- **📐 架构单一事实源收敛与代理端口统一 (Structural Refactoring)**：
    - 收敛 `AssetType` 定义至 `src/types/index.ts` 单一事实源，消除双份定义；
    - 统一设置面板各板块代理默认回退端口为 `10808`，消除 `7890` 硬编码割裂；
    - 清理 `WatchlistProvider` 中拖拽重排的回调死分支；
    - `README.md` 剔除未实现的「换手率」描述，`RELEASE.md` 全面更新至 1.1.5 双平台发布规范。
- **🧪 Binance 报文契约单测与原生覆盖率统计 (Test Suite Enhancement)**：
    - 补齐 `BinanceService` 24hr 行情报文解析、展示名格式化及失效抑制黑名单单测（Subtest 39）；
    - `package.json` 新增 `npm run test:coverage` 原生零依赖测试覆盖率统计命令。
- **⌨️ 快捷键文档说明统一与勘误 (Shortcut Alignment)**：
    - 统一全文档颜色脱敏快捷键为 `Ctrl + Alt + L` / `Alt + L`（Mac: `Cmd + Alt + L`），纠正了历史日志与英文文档中曾残留的 `Ctrl + Alt + C`，与 `package.json` 实际注册键位保持绝对一致。
- **🏷️ 自选新增向导支持备注友好名称 (Custom Display Name on Addition)**：
    - 新增标的时（`marketlens.addItem`）提供第二步友好名称（如“特斯拉 / TSLA”）快捷输入提示，回车或留空默认采用标的代码，彻底解决新添标的在侧边栏与状态栏仅显示代码、缺乏友好名识别的问题。
- **🛡️ 工具函数单一来源去重 (Deduplication Guard)**：
    - 收敛 `isContractAddress()` 至 `src/utils/symbolHelper.ts` 单一事实源，`src/utils/inputValidator.ts` 统一复用导出，杜绝校验分化。
- **📡 行情异常静默丢弃防御与可观测性强化 (Quote Discard Observability)**：
    - 在 A股、港股、美股数据抓取服务中，针对上游报文长度异常（如美股 `f.length < 10`、A股/港股 `f.length < 35`）补充结构化诊断警告（`logger.warn`），使标的不存在、已退市或接口协议变更即时可观测，杜绝静默失效。
- **🔒 核心依赖安全补丁升级 (Security Patch)**：
    - `axios` 从 `^1.6.7` 升级至最新安全稳定版本 `^1.7.9`，消除潜在安全漏洞。
- **⏱️ 闭市轮询判定解耦与可测试性强化 (Polling Decision Decoupling)**：
    - 将 `scheduler.ts` 中针对 A股、港股、美股的闭市跳过复合条件（结合配置、开休市状态、首轮冷启动兜底、强制刷新与单组刷新 5 维判定）抽离为独立的无状态纯函数 `shouldSkipMarketPolling`，消除重复样板代码；
    - 针对决策矩阵补充完整边界单元测试（Subtest 40）。
- **🧪 内存活跃集修剪基准测试与表述严谨化 (Memory Footprint Benchmark)**：
    - 补充 `Active-Set Prune` 循环堆内存基准测试（Subtest 41），验证高频自选变动与缓存回收下的内存稳定性（Heap Used 增量稳定 < 15MB~25MB）；
    - 修订中英文文档关于内存占用的措辞，使工程描述更加科学严谨。

</details>

## [1.1.4] - 2026-09-11

<details>
<summary><b>⚡ 价格预警、批量拖拽与内存回收</b></summary>

### 🚀 新增特性与核心优化 (New Features & Improvements)

- **⚡ 价格阈值与剧烈波动预警监控 (Price Alert System)**：
    - 支持为任意自选标的设置目标价突破预警（≥ 目标价）、跌破预警（≤ 目标价）与单日剧烈波动预警（|涨跌幅| ≥ 设定百分比）；
    - 支持双通道告警：VS Code 右下角轻量通知弹窗与底部状态栏高亮闪烁；
    - 内置 15 分钟智能防轰炸冷却机制（可自定义冷却时间），避免关键点位反复震荡频繁弹窗；
    - 老板键静音守卫：老板键激活期间一票否决全部预警通知，防止摸鱼时意外弹窗露馅；
    - 标的行常驻持久化 `🔔` 标记，悬停气泡可实时查看当前生效的预警规则；
    - Webview 设置面板新增「⚡ 到价预警」集中监控矩阵，支持批量查看、编辑阈值与总开关控制，与侧边栏 0ms 双向实时同频联动。
- **🖱️ 多选批量拖拽排序 (Multi-Select Batch Reorder)**：
    - 支持按住 `Shift`（连续多选）或 `Ctrl` / `Cmd`（离散多选）选中多只标的，一次性批量拖拽重排；
    - 严格的同组拖拽边界隔离守卫，彻底拦截跨板块误拖拽；
    - 单次原子化写入配置，防止并发 I/O 冲突，排序变更实时推送到设置面板。
- **🧹 内存行情缓存活跃集对齐与动态垃圾回收 (Active-Set Pruning & LRU)**：
    - 实现全量自选活跃集指纹比对算法，自动清理已删除标的的历史残留死缓存；
    - 深度优化后台长期运行的内存占用（增量堆内存通常 <15MB~25MB），彻底杜绝内存泄漏。
- **🔄 恢复出厂设置联动清空预警**：
    - 执行“恢复出厂默认设置”时，同步清空重置所有价格预警规则字典与冷却状态，彻底还原为最干净的安装初态。
- **🏷️ 标的名称跨端一致性修复**：
    - 引入统一名称解析器，优先尊重用户在配置中定义的自定义名称（如 Cloudflare、纳斯达克综合指数或个人昵称），杜绝被行情接口返回的机器译名（如“科赋锐”）意外覆盖。
- **📖 开源社区与反馈渠道强化**：
    - 项目现已全面开源，README 与关于页面新增 GitHub Issues 与 GitHub 开源仓库入口。

</details>

## [1.1.3] - 2026-09-10

<details>
<summary><b>🛡️ 稳定性与体验修复</b></summary>

### 🚀 稳定性与体验修复 (Fixes & Usability)

- **状态栏总控与分板块开关彻底解耦**：
    - 修复关闭 A 股轮播时状态栏意外消失的问题；
    - 修复设置中显式关闭 `marketlens.statusBar.enabled` 状态栏未隐藏的逻辑硬伤，确保全局总开关一票否决；
- **新增美股类股（Class Shares）支持**：
    - 全面支持 `BRK.B`（伯克希尔·哈撒韦）、`BF.B`、`BRK.A` 等带点号/连字符的美股核心标的实时行情添加与解析；
- **链上代币添加与防误触防护**：
    - 拦截复制 Etherscan / BscScan 交易详情（Tx Hash）时被截断添加为假代币的问题，并提供精准引导提示；
- **配置与交互体验优化**：
    - 统一本地代理默认端口为 `10808`（适配 v2rayN/Clash 等主流客户端）；
    - 修复快捷键表格 `Alt + M`、`Alt + K`、`Alt + L` 与 package.json 声明不一致的问题；
    - 设置面板切换 Tab 状态精准保留，代理端口修改后即时生效无需重启。

</details>

## [1.1.1] - 2026-09-07

<details>
<summary><b>🚀 功能增强与交互体验升级 (1.1.1)</b></summary>

### 🚀 Comprehensive Enhancements & Usability Upgrades / 功能增强与交互体验升级

#### English

- **Status Bar Smooth Carousel & Independent Controls**:
    - Resolved carousel freezing issue caused by background quote refreshes, allowing all symbols across all markets to rotate seamlessly.
    - Added global status bar carousel toggle in General Settings (`marketlens.statusBar.enabled`).
    - Added independent carousel toggles for each market: A-Shares (`marketlens.aShare.statusBar`), HK Stocks (`marketlens.hkStock.statusBar`), US Stocks (`marketlens.usStock.statusBar`), Binance (`marketlens.binance.statusBar`), and Alpha (`marketlens.alpha.statusBar`).
- **Drag & Drop Reordering & Pinning**:
    - Implemented native VS Code `TreeDragAndDropController` support. Users can long-press and drag any stock/token to reorder items within categories.
    - Added a pin button (`$(pin)`) on hover to instantly pin any symbol to the top of its category.
- **One-Click Clear Watchlist & Factory Reset**:
    - Added "Clear Watchlist" in General Settings to wipe all preset symbols across all markets with safe confirmation dialog, allowing users to start from scratch.
    - Added "Restore Factory Defaults" to reset all symbols and configs back to fresh installation state anytime.
- **Official Telegram Community & Support**:
    - Added official Telegram community group link (`https://t.me/+-eZR0R--jyUwN2Nl`) and author direct Telegram link (`https://t.me/Dev_QQQQQ`) with one-click and copy buttons in the About panel.
- **Documentation & Packaging Restructure**:
    - Separated developer packaging instructions into dedicated `RELEASE.md`.
    - Comprehensive rewrite of `README.md` showcasing all features and quick-start guides.
- **Dynamic Versioning & Startup Optimization**:
    - Settings panel automatically and dynamically fetches and displays the current extension version (`v1.1.1`) directly from package metadata.
    - Replaced legacy `*` star activation with official `onStartupFinished` to improve startup performance.

#### 中文

- **底部状态栏丝滑轮播与各板块独立开关**：
    - 彻底修复后台刷新重置索引导致的轮播卡顿在前两项的问题，实现全市场标的（A股/港股/美股/Binance/Alpha）丝滑滚动展示。
    - 在【通用设置】中新增“全部标的参与底部轮播”总控开关（`marketlens.statusBar.enabled`），关闭后状态栏彻底隐藏。
    - 在【A股】、【港股】、【美股】、【Binance】、【Alpha】各板块页面中分别新增独立的“参与底部轮播”开关，自由定制轮播内容。
- **长按拖拽上下排序与一键置顶**：
    - 支持 VS Code 原生 `TreeDragAndDropController` 拖拽规范，长按标的即可在当前分组内自由上下拖动调整排序。
    - 标的悬停新增置顶图钉图标（`$(pin)`），点击即可一键置顶到当前分组顶部。
- **一键清空标的与出厂默认恢复**：
    - 新增“一键清空自选标的”卡片（带二次确认），方便从零开始添加自己关注的资产。
    - 新增“恢复出厂默认设置”卡片，随时一键还原为系统出厂预设标的。
- **官方 Telegram 社区与作者直联反馈**：
    - 在“关于与帮助”页面新增官方 Telegram 交流群链接（`https://t.me/+-eZR0R--jyUwN2Nl`）及作者个人 TG 对话（`https://t.me/Dev_QQQQQ`），支持一键唤起与一键复制。
- **文档与发布体系重构**：
    - 将开发者打包发布指南分离至独立 `RELEASE.md`，主 `README.md` 全面扩充各项功能使用说明。
- **动态版本号展示与启动优化**：
    - 设置中心动态读取运行时包元数据展示版本号（`MarketLens v1.1.1`）。
    - 规范化激活事件为 `onStartupFinished`，彻底消除性能警告。

</details>

---

## [1.1.0] - 2026-09-07

<details>
<summary><b>🚀 重磅新增：港股与美股市场支持</b></summary>

### 🚀 Major Feature Release: HK & US Stocks / 重磅新增：港股与美股市场支持

#### English

- **Hong Kong Stocks (HK Stocks)**:
    - Full support for HK stocks via Tencent Finance API (`hk00700`, `hk03690`, `hk09988`, `hk06030`, `hk01810`, etc.).
    - Multi-currency display with `HK$` Hong Kong Dollars in tooltips, tree items, and detail cards.
    - Intelligent closed-market detection for HK trading hours (09:30-12:00, 13:00-16:10).
- **US Stocks & Indices**:
    - Full support for US stocks (`AAPL`, `NVDA`, `TSLA`, `NET`, `TSM`, `AMD`, `AVGO`, `ARM`, etc.) and market indices (`.IXIC`, etc.).
    - Multi-currency display with `$` US Dollars.
    - Intelligent trading hours detection for US market (21:00 to 05:00 next day).
- **Settings & Management**:
    - Independent settings tabs in the Settings Webview for HK and US stocks, supporting direct connection or proxy routing, stop polling during market closure, and auto proxy detection.
    - Smart input parser automatically identifies 5-digit codes as HK stocks, English letter codes as US stocks, and provides instant group suggestions.
- **Default Watchlists & Instant Display**:
    - Expanded Binance default crypto list (`BTC`, `ETH`, `SOL`, `BNB`, `DOGE`, `ARB`, `OP`, `APT`, `ORDI`, `ASTER`, `ETC`, `LUNA`).
    - Added popular on-chain Alpha tokens deduplicated and automatically resolved with readable token symbols (`翻身币`, `quq`, `人生K线`, `PALU`, `恶俗企鹅`, `我踏马来了`, `DONKEY`, `4`, `客服小何`, `哈基米`, `币安人生`, etc.).
    - Pre-configured trending US tech stocks and HK blue-chip stocks.
    - Zero-wait initial display: Immediately renders the tree skeleton on startup and guarantees instant first-load quote retrieval even during market closure or weekends.

#### 中文

- **港股市场板块**：
    - 接入腾讯官方港股接口，支持全部港股标的（如 `hk00700` 腾讯控股、`hk03690` 美团、`hk09988` 阿里巴巴、`hk00981` 中芯国际、`hk06030` 中信证券、`hk01810` 小米集团等）。
    - 支持 `HK$` 港币多币种专属结算与悬停卡片展示（含开盘、昨收、高低、成交量(股)、成交额(港币)）。
    - 港股智能休市检测（工作日 09:30-12:00, 13:00-16:10），闭市期间自动停止高频轮询节约资源。
- **美股市场板块**：
    - 接入腾讯官方美股接口，支持美股个股（`AAPL` 苹果、`NVDA` 英伟达、`TSLA` 特斯拉、`NET` Cloudflare、`TSM` 台积电、`AMD` 超威半导体、`AVGO` 博通、`ARM` 安谋等）及主要指数（如 `.IXIC` 纳斯达克指数）。
    - 支持 `$` 美元专属结算展示。
    - 美股智能交易时段检测（工作日 21:00 至次日凌晨 05:00），夜间盘中自动跟踪。
- **设置与交互体验升级**：
    - 设置面板中新增独立的【港股市场】与【美股市场】专栏配置，支持开关、闭市休眠、直连/代理切换与一键代理探测。
    - 添加自选智能识别器升级：输入 5 位数字或 `hk` 前缀自动匹配港股；输入纯英文字母代码（如 `AAPL`）自动推荐美股。
- **自选预设与秒级开箱体验**：
    - 扩充出厂默认自选库：Binance 新增 SOL、BNB、DOGE、ARB、OP、APT、ORDI、ASTER 等主流与热门币种；Alpha 板块新增 11 个经过链上去重并智能解析出代币简称（翻身币、quq、人生K线、PALU、恶俗企鹅、我踏马来了、DONKEY、4、客服小何、哈基米、币安人生等）的链上标的；美股预设包含 Cloudflare 及热门芯片龙头股。
    - 首次启动秒级展示：启动时立即展示标的骨架，无需空白等待；首次刷新强制穿透拉取最新收盘价，彻底解决“安装后首次打开无价格”问题。

</details>

---

## [1.0.0] - 2026-09-06

<details>
<summary><b>🚀 正式发布 (Major Release)</b></summary>

### 🚀 Major Release / 正式发布

#### English

- **Multi-Asset Coverage**:
    - Full support for China A-Shares (Shanghai, Shenzhen, Beijing markets) via Tencent Finance API with intelligent closed-market detection.
    - Real-time mainstream crypto tracking via Binance (BTC, ETH, SOL, and all USDT/USDC pairs).
    - On-chain token tracking via DexScreener across Solana, BSC, Base, Ethereum, and more by contract address.
- **Focus & Workplace Privacy**:
    - **Focus Mode**: Instant toggle (`Ctrl + Alt + M` / `Alt + M` on Win/Linux, `Cmd + Alt + M` on Mac) to hide or restore the sidebar, status bar tickers, and settings webview simultaneously.
    - **Compact Mode**: Shortcut (`Ctrl + Alt + K` / `Alt + K`) to display status bar prices in compact build log format (e.g. `git:(main) build: 65.2k`).
    - **Color Neutral Mode**: Shortcut (`Ctrl + Alt + L` / `Alt + L`, Mac: `Cmd + Alt + L`) to eliminate red/green color stimulation, rendering all tickers in neutral editor colors.
    - **Customizable Shortcuts**: One-click quick link to VS Code native keyboard shortcuts configuration.
- **Network & Enterprise Security**:
    - Zero-latency direct domestic connection for A-Shares.
    - Optional proxy routing for Binance & Alpha for enhanced connectivity.
    - Automatic proxy port detector supporting Clash, Clash Verge, v2rayN, etc.
- **UI & Usability**:
    - Interactive graphical Settings Webview panel with real-time toggle switches.
    - Asset deletion with confirmation prompts and treeview synchronization.
    - Instant input validation for symbol search and contract address parsing.
    - Guaranteed initial quote fetch uponing, even during market closure.

#### 中文

- **全市场资产三合一覆盖**：
    - **A股市场**：直连腾讯官方金融行情接口，全面支持沪深京全市场股票与指数，支持闭市期间智能休眠。
    - **币安主流币**：实时获取 BTC、ETH、SOL 等主流币及山寨币 24h 最新价格与涨跌幅。
    - **Alpha 链上新币**：接入 DexScreener 全球链上聚合源，输入合约地址即可实时追踪 Solana、BSC、Base、以太坊等全链资产。
- **工作区隐私与专注模式**：
    - **专注模式（一键隐藏/恢复）**：快捷键 `Ctrl + Alt + M` 或 `Alt + M`（Mac: `Cmd + Alt + M`），瞬间收起自选侧边栏、隐藏状态栏行情、关闭设置面板，再次按下瞬间复原。
    - **极简展示模式**：快捷键 `Ctrl + Alt + K` 或 `Alt + K`，将状态栏行情展示为简洁构建日志样式（如 `git:(main) build: 65.2k`）。
    - **颜色脱敏模式**：快捷键 `Ctrl + Alt + L` 或 `Alt + L`（Mac: `Cmd + Alt + L`），一键褪去红绿色视觉刺激，所有涨跌幅与图标采用编辑器默认中性色。
    - **自定义快捷键**：设置面板提供一键直达 VS Code 原生快捷键配置界面的按钮，随心改键。
- **网络代理支持**：
    - A股默认境内零延迟直连。
    - 币安与 Alpha 支持配置独立代理服务器，保障跨境行情接口连通性。
    - 支持一键自动探测本机活跃代理端口（兼容 Clash、Clash Verge、v2rayN 等）。
- **交互与用户体验**：
    - 专属图形化设置面板（Webview），所见即所得。
    - 自选列表支持悬停快速删除与确认弹窗防误触。
    - 完善的输入校验：支持代码/代币/合约地址自动识别与非法输入拦截。
    - 首次打开插件即刻抓取最新收盘行情，即使周末闭市也能一览无余。

</details>

---

## [0.2.0]

<details>
<summary><b>🔗 链上追踪、代理探测与悬停卡片</b></summary>

### Added / 新增

- **EN**: Integrated DexScreener API for DEX on-chain token tracking (Alpha tab) by pasting contract addresses.
- **ZH**: 接入 DexScreener 链上行情接口（Alpha 分组），支持粘贴合约地址一键添加全链新币。
- **EN**: Added network proxy settings with auto-detect proxy port for enhanced privacy.
- **ZH**: 新增网络代理配置面板与本机代理端口一键自动探测功能。
- **EN**: Added hover tooltip detail cards showing, high, low, volume, and liquidity depth.
- **ZH**: 新增自选条目悬停详情卡片，可查看今开、昨收、最高、最低、成交额及链上流动性池深度。

### Improved / 优化

- **EN**: Optimized polling timers to reduce CPU and network usage during market non-trading hours.
- **ZH**: 优化轮询调度器，在非交易时间段大幅降低网络与 CPU 资源占用。

</details>

---

## [0.1.2]

<details>
<summary><b>✨ 极简模式、颜色脱敏与事件修复</b></summary>

### Added / 新增

- **EN**: Introduced Compact Mode (`Ctrl + Alt + K`) to display tickers in concise build log format.
- **ZH**: 引入极简展示模式（快捷键 `Ctrl + Alt + K`），将状态栏行情展示为简洁构建日志样式。
- **EN**: Added Color Neutral mode (`Ctrl + Alt + C`) to mute red and green color highlights.
- **ZH**: 引入颜色脱敏模式（快捷键 `Ctrl + Alt + C`），消除红绿视觉刺激。

### Fixed / 修复

- **EN**: Fixed tab switching and Webview message communication event handlers.
- **ZH**: 修复设置面板 Tab 切换以及 Webview 消息通信监听机制。

</details>

---

## [0.1.1]

<details>
<summary><b>🎯 专注模式与状态栏轮播</b></summary>

### Added / 新增

- **EN**: Implemented Focus Mode (`Ctrl + Alt + M`) to instantly toggle visibility of all market elements.
- **ZH**: 实现一键专注模式（快捷键 `Ctrl + Alt + M`），瞬间隐藏与恢复所有行情相关界面。
- **EN**: Added multi-asset rotation for VS Code status bar display.
- **ZH**: 新增状态栏多资产轮播滚动展示功能。

### Fixed / 修复

- **EN**: Resolved ticker update delay under unstable network conditions.
- **ZH**: 优化弱网环境下的重试逻辑，解决行情刷新偶发延迟的问题。

</details>

---

## [0.1.0]

<details>
<summary><b>🎉 初始版本发布</b></summary>

### Added / 新增

- **EN**: Initial project release.
- **ZH**: 项目初始版本发布。
- **EN**: Basic China A-Share market quote fetching (Shanghai & Shenzhen exchanges).
- **ZH**: 支持 A 股沪深基础行情数据拉取。
- **EN**: Basic Binance cryptocurrency quote fetching (BTC / ETH USDT pairs).
- **ZH**: 支持币安主流加密货币行情（BTC / ETH 等 USDT 币对）。
- **EN**: Left sidebar watchlist treeview to manage and view favorite assets.
- **ZH**: 左侧侧边栏自选列表，支持资产展示与基础自选管理。

</details>
