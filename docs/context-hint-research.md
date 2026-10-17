# Context Hint for Pi：源码研究

核查日期：2026-10-17。范围仅为 Pi 上游研究；未安装、运行扩展或请求模型，未研究 dsh-TUI 内部实现。本地适配方案由主任务另行补充。

本文保留研究阶段的版本与验证状态快照，不代表当前安装或交付状态。产品取舍以[已确认设计](context-hint-design.md)及[正式规格工作副本](context-hint-spec.md)为准：本项目不采用 Pi 的自动 repair 或额外摘要历史留存；文末的“本轮未做”仅指当时的研究阶段。

## 来源与版本

- 权威仓库：[thonean/pi-context-hint](https://github.com/thonean/pi-context-hint)。`npm view` 的 repository、homepage 与 GitHub API 返回一致。
- [npm 元数据](https://registry.npmjs.org/pi-context-hint)：`latest = 0.1.2`，发布时间 `2026-10-11T07:19:17.207Z`；[发布包 B](https://registry.npmjs.org/pi-context-hint/-/pi-context-hint-0.1.2.tgz) 的 `package.json` 亦为 0.1.2，MIT；包内 LICENSE 为 © 2026 Context Hint contributors。
- [v0.1.2 tag](https://github.com/thonean/pi-context-hint/tree/513d99798c358053c5f7c3d2e7ea6ee5238dbae2) 指向 `513d99798c358053c5f7c3d2e7ea6ee5238dbae2`。当前 [main 提交](https://github.com/thonean/pi-context-hint/commit/fdaffa999b3dd150d6852d593e5e5f36483bd080) 为 `fdaffa999b3dd150d6852d593e5e5f36483bd080`，提交说明为新增独立 summary thinking controls；**这是 main 变化，不能算作 npm 0.1.2 已发布行为**。本次未完成 main 全量源码比对。

下文行号统一指从 B 解压得到的 `package/dist/context-hint.js`（1448 行），不是 main 行号；README 指 B 内 `package/README.md`（106 行）。直接审读发布产物，避免把源码分支与发布版混淆。

## 三层状态：不是三段自由文本

| 层 | 精确字段与语义 | 证据（B） |
| --- | --- | --- |
| Project | `summary, purpose, architecture[], constraints[], conventions[], importantDecisions[{decision,rationale?}], currentPhase`；跨会话、同仓 worktree 共享 | L26–34、72–102、158–227 |
| Session | `goal, currentFocus, currentHypothesis, status, openLoops[], ruledOut[], blockers[], nextSteps[]`；status 为 `exploring / implementing / verifying / blocked / decision-needed / done` | L16–25、60–70、337–338 |
| TurnDelta | `accomplished[], learned[], ruledOut[], codeCues[], verification[], failures[], decisionsMade[], questionsForHuman[], nextSuggestedAction?`；记录本次 settled interaction 的变化，不是整个会话摘要 | L441–458 |

摘要 envelope 为 `{turnDelta, sessionPatch, projectPatch: object|null, attentionCue:{level,message?}}`。attention level 为 `none / info / decision-needed / blocked / risk`。Session patch 的数组直接替换；Project 数组通常 trim、去重并累加，空数组才清空；重要决策以 decision 文本为键合并，标量采用后写值。不是通用 JSON merge，也不是只追加的永久真相。（B L60–102、419–459）

Session 没有单独的“最新状态文件”：Pi 的 `context-hint-v1` custom entry 保存 generation ID，按当前 `getBranch()` 顺序读取 ready generation 的 Session 快照；`session-reset` 标记令滚动状态从空开始。因此新会话空 Session，fork/clone 沿继承的分支记录恢复后各自演进；不是一个 repository 级 Session 共用缓存。generation record 包含 ID、session ID、pending/ready/error、时间、projectEpoch、baseSessionState、evidence，成功后再写 hint/sessionState/projectState。（B L118–156、723–787；README L49–59）

## 触发、界面、模型

- 默认 `enabled:false`、摘要模型 `inherit`；全局显示偏好默认展开、动画开启。`/context-hint enable` 后仅在 **TUI 的 `agent_settled`** 生成，不是在 open/resume 时自动补做，也不是每个 token、每次工具调用都请求。（B L35–44、612–618、669–701）
- 采集链：`before_agent_start` 重置 interaction、记录用户 prompt/图片数量；`message_end` 收助手 text；`tool_execution_start/end` 用 call ID 关联输入、结果、成功与路径。settled 后快照，异步串行排队。（B L581–618、723–751）
- `session_start` 恢复项目/记录；遗留 pending 标成 interrupted。`session_before_tree` 取消、`session_tree` 加载记录；`session_shutdown` 取消并清动画。disable、reset 也取消 pending；regenerate 用最近记录的已保存 evidence 再生成。（B L550–579、619–640、682–718）
- `alt+o` 或 `/context-hint toggle` 统一折叠/展开卡片；`motion reduce` 降低动画。卡片是 custom transcript entry，状态栏另报状态；不是跨代理监控/完成通知。卡片不自动注入后续普通 agent prompt，但前次 Project/Session 状态会进入下一次摘要请求。（B L495–511、1007–1020、1210–1212；README L21–23、87–89）
- 模型可继承当前 Pi 模型，也可从 scopedModels（非空时）或 registry available 列表中显式选 provider/id；不可用报错，不自动换摘要模型。**额外副作用**：启用后记忆项目的 `lastSessionModel`，新会话或空 startup 可能 `pi.setModel` 恢复主会话模型；不能把整个扩展理解成完全不影响主模型的显示插件。（B L550–560、1021–1027、1139–1178）

## 结构化输出与 TurnDelta 处理

通过 `modelRegistry.complete` 请求 `context_hint_v1` 工具，schema `additionalProperties:false`，要求严格结构（`strict:'prefer'`）；常规字符串列表至多 8 项、每项 500 字符，codeCues 至多 3 项，字段还各有长度限制。接收**恰好一个**指定 tool call；没有 tool call 时允许纯 JSON 文本（可去代码围栏），仍走 `validateToolCall`。兼容归一化仅包括 attentionCue 字符串转对象、`in_progress` 转 `implementing`。（B L413–465、1237–1286）

codeCue 为 `{path,reason,kind}`，kind 为 `modified/created/deleted/verified/focal`。path 必须来自成功工具输入中的 `path/file/filePath` 字段，且在 sourceRoot 内；reason 非空。**这是路径候选约束，不是 git diff、文件存在性或“已验证行为”的独立证明**；shell 命令字符串里的路径可能漏采，成功 read 也不能证明 modified。当前 schema 没有行号，renderer 的旧 `filesTouched/lineStart/lineEnd` 回退不代表新输出可生成精确行号。（B L104–116、1116–1137、1385–1391）

首请求失败且未 abort，会向同一模型发一次 repair（不只 schema 错误，网络异常也会进入此分支）；第二次失败返回 `emptyHint`：空 patch、failures 说明、info cue。**这种降级仍可落成 ready 记录**，并非所有摘要失败都会显示 error 状态。无模型、取消、项目 epoch 失配等另走 error。（B L753–824、1180–1201、1254–1269）

TurnDelta 原样保存，Session patch 合并，Project patch 另经启发式资格检查：项目尚空且有项目文件、成功 write/edit 涉及 durable 文件（CONTEXT/AGENTS/CLAUDE/README、manifest、docs/adr），或 prompt 命中特定中英文决策词，才允许更新。它不是语义事实证明或人工批准。（B L773–787、1288–1297）显示时只选 accomplished/learned/decisionsMade 前 3 条、codeCues 前 3 条、detail 前 6 条，NEXT 优先用 turn 的建议再取 session.nextSteps[0]；数据比 UI 展示丰富。（B L1373–1407）

## 项目识别、落盘与并发

- Git：`git -C cwd rev-parse --show-toplevel --git-common-dir`（5 秒 timeout）；sourceRoot 是当前 worktree 顶层 realpath，identity 是 common Git dir realpath，因此同仓 worktree 共用 Project，不是按 branch 或 remote URL 合并；独立 clone 不共用。非 Git 向父目录找 `CONTEXT.md / README.md / .pi`，否则用 cwd。identity 的 SHA-256 前 24 个十六进制字符仅用于目录命名。（B L158–167、1030–1059）
- 数据位于 Pi `getAgentDir()/context-hint/`：全局 `settings.json`；`projects/<id>/config.json, project.json, generations/<generationId>.json`。项目文档带 identity/sourceRoot/epoch/revision/updatedAt/state，证据与生成快照持久保存。reset 不删历史，未见自动裁剪。（B L158–233；README L91–95）
- 写 JSON 用同目录独占临时文件、权限 `0600`、fsync 后 rename；坏 JSON/形状改名 `.corrupt-<time>` 再回默认。读取 generation 的形状检查相对浅，不能等同于完整输出 schema 重验。（B L260–338）
- 单进程 `jobTail` 串行生成；Project 更新/reset 用 mkdir 锁，等待上限 2 秒、25ms 轮询、锁超 30 秒按陈旧移除；锁内重读并按 expectedEpoch 合并，reset 递增 epoch 防旧任务重新写回。**revision 不是 compare-and-swap**，并发标量仍后写覆盖；config/settings 的原子替换没有同等 merge 锁，也不自动跨进程实时同步内存配置。不能从“原子文件写”推导整个多文件 generation + transcript entry 是事务。（B L186–227、260–321、723–787）

## 隐私、成本与失败边界

发送的是当轮选取证据及旧 Project/Session，不重放全部 transcript：prompt 4000 字符、assistant 合计 6000、前 24 个 tool facts（输入 700/结果 1000）、项目 CONTEXT/README 各 4000、package.json 2000；仅图片计数而非图片内容。assembled JSON prompt 截至 20000 JavaScript 字符单位，repair 另加指令；每次输出 `maxTokens:3500`，`cacheRetention:'none'`、独立 request session ID。通常一轮 1 次调用，失败可变 2 次，手动 regenerate 再收费；没有用量/金额账本，字符限制不等于 token 或账单上限。（B L581–610、1079–1105、1180–1235；README L77–89）

发送前仅 regex 脱敏私钥、Bearer 和部分 token/key/password；仍可能漏掉秘密，路径候选等元数据不保证脱敏。生成字段 schema 校验后**没有再脱敏**就落盘；本地记录不加密、不自动过期，reset 不是删除数据，provider 留存策略也不由 `cacheRetention:'none'` 保证。工具输出“不作指令”是 system prompt 要求，不是可靠的防注入隔离。（B L45–58、603–610、773–787、1203–1217；README L91–95）

明确失败处理包括：模型不可用、缺失/坏 generation 文件、reload/restart/fork interruption、分支切换/退出/disable/reset abort、project busy。摘要请求传 AbortSignal，但本扩展未设显式请求超时；provider 自己的重试/超时、跨进程竞争与实际费用未实测。（B L294–319、562–575、753–824、1061–1077、1180–1235）

## 给后续设计的结论（建议，不是已实现功能）

值得借鉴的是“当轮 delta + 滚动 Session + 慢变 Project”的分层，以及证据受限、pending/ready/error 可见、切换取消、失败保留原状态。不要直接照搬眼睛动画、主模型恢复副作用、无限历史存储与宽松 Project 自动升格规则。先区分纯 UI recovery cue 与额外模型摘要，再明确用户授权、预算、保留期及共享项目更新语义；具体接入点和本地可行性由主任务的 dsh-TUI 调研补充，本笔记不作已可用宣称。

未验证社交视频宣传：未提供具体社交链接，亦未据视频推导能力。发布 README 的 demo 明确称为 **fictional** preview；多项目实时监控、其他代理完成提醒、零成本/完全本地、自动写回 agent 长期记忆，均不能由该 demo 推断。（README L15–23、77–95）

验证：只读 `npm view`、GitHub API repo/commit/tag、下载并静态审读 npm tarball；通用 web 搜索已执行但无可用索引结果，不作为证据。GitHub clone/raw 读取受网络错误影响，未运行上游测试、Pi、安装命令或任何模型请求；发布版行为以实际包代码为准。

## dsh-TUI 接入核查与建议方案

以下是主任务补充的本地源码核查与设计建议，**不是已经实现或运行通过的功能**。

### 已有基础与缺口

- 当前本地 elevenfund fork 为 0.12.0，源码已有 `/recap`：单次、无工具摘要，取最近 6 组用户/助手条目，6000 字符预算；只在打开/恢复会话时自动生成，结果为易失 UI 状态，不写会话日志。当前请求借用主会话的 provider/model，并没有独立 summary 模型配置。证据：[`recap.ts`](../src/dsh-adapter/recap.ts)、[`session-metadata.ts`](../src/dsh-adapter/channel/session-metadata.ts)、[`use-side-panels.ts`](../src/screens/chat/use-side-panels.ts)。
- 本地已有 `tuiStatus.registerView`、`tuiShortcuts`、`tuiScenes`；rich status 每项最多 3 行，适合摘要入口，不适合长卡片。已有保留快捷键检查，不能直接劫持内建键。证据：[`status.ts`](../src/dsh-adapter/status.ts)、[`shortcuts.ts`](../src/dsh-adapter/shortcuts.ts)、[`scenes.ts`](../src/dsh-adapter/scenes.ts)。
- 本地 `tuiPluginStorage` 已有带文件锁的原子写及进程内串行队列，但 API 只有 get/set/delete；不能把两次调用的 read-modify-write 当成事务。每插件最多 256 keys、256 KiB，单 key 最长 128 字符，因此不应在这里存无限 Turn 历史或完整证据。证据：[`plugin-storage.ts`](../src/dsh-adapter/plugin-storage.ts)。
- 已只读核对上游 main 提交 `e709863019d56897e64495699c3a945cce194d00` 的 [`panels.ts`](https://github.com/ccch1mneyyy/dsh-TUI/blob/e709863019d56897e64495699c3a945cce194d00/src/dsh-adapter/panels.ts)：`ctx.tuiPanels` 可注册插件侧栏；其只读 snapshot 刻意不包含 transcript 正文、凭证或文件内容，`compact` 展示槽尚未挂载、sendToChat 尚未授权。**不能把新版接口假定为当前 fork 已有，或从面板 snapshot 直接获取对话全文。**

### 建议的第一版

功能名暂定 `Context Hint`，实现为独立 DSH/Cordis 扩展，TUI 只消费结构化展示数据。若对齐后的 fork 已有上游 panel 接口，优先复用；否则先用现有 compact status + scene，不为这一功能另造面板框架。

| 层 | 默认呈现 | 更新与隔离 |
| --- | --- | --- |
| Project | 项目目标 + 关键约束/决策 | 以 realpath 后的 Git common dir 识别同仓 worktree；独立 clone 不自动合并。模型只提候选，确认后提升为共享决策，不把分支完成状态写成全项目事实 |
| Session | 任务目标、当前状态、阻塞、下一步 | session ID 隔离，同时显示 worktree/branch；fork/rewind 时依据实际分支恢复，不能从父会话盲目拷贝“已完成” |
| Turn | 本轮完成/发现、验证结果 | 仅在本次用户交互真正收敛后更新，区分成功、失败、取消；不按 token 或每个 tool step 请求摘要 |

- 默认折叠为一句“当前进展 → 下一步”；`Alt+O` 展开三层，另提供可配置快捷键与 slash 命令兜底。快捷键冲突、macOS Option 行为、窄终端及 inline/fullscreen 必须实测。
- 独立 summary provider/model 使用宿主已有模型目录与凭证服务；绝不调用 setModel 改主会话模型，不复制 API key，也不把摘要工具暴露给主 agent。默认继承模型与显式独立选择均可提供。
- 一次有界的后台请求生成 Turn 与 Session 增量，以及可选 Project 建议；切换会话时按捕获的 session ID/事件位置归属，迟到结果不能落到当前新会话。恢复时先读已有卡片，无新事件则不额外请求。
- 摘要不自动注入主模型上下文、不伪造用户/助手或工具事实；它是给人看的恢复提示，不替代真实事件日志和验证结果。
- 结构化输出必须有运行时校验。缺字段、畸形 JSON、超时或模型不可用时保留上次有效卡片并标记更新失败；不得用“空成功”覆盖有效状态。可提供一次有界修复，但需要明确额外调用成本。
- Project 慢变信息默认确认后更新；会话进展不自动升格为永久约束。跨进程合并和 quota 满时的行为要单独验证，不从 atomic write 推导多次读写具备事务性。
- 复用既有插件存储，仅保留最新 Session/Turn 和有界历史；不默认长期保存所有 prompt/tool 输出。启用自动摘要前明确会向所选 provider 发送何种内容，脱敏不能等同于不会泄密。

### 实施顺序与验收

1. 先完成之前的 Harness 0.2.1-rc.2 兼容改造，并在独立 profile 验证真实启动；前一轮“模块能链接”的证明不足以算整个 TUI 已适配。
2. 做一个纵向原型：单 Session、手动刷新、独立模型、折叠卡、保留最后有效结果。用确定性 fixture 校验解析/展示，再跑一次明确获准的真实摘要调用。
3. 接上交互收敛后的自动生成、Session 恢复，再加 Project/worktree 共享和人工确认。启用此功能时要避免旧 auto recap 同时重复收费，配置变更须在实施阶段明确说明。
4. 验收重点：两个 worktree 的 Project 共用但 Session 不串；A 切 B 后 A 的迟到请求不污染 B；取消/失败不显示完成；缺 turnDelta 不崩溃且旧卡保留；无新事件恢复不重请求；重启/fork/rewind 状态正确；窄终端、中英文与两种终端模式可操作。
5. 最后执行仓库要求的 build、相关回归与 package 检查，再制作本地 `.tgz`。远端 fork、push、正式 Release/npm 发布和替换用户现用 profile 都是后续实施动作，本轮未做。

本轮实际改动仅本研究笔记；没有安装 Pi 扩展、修改 TUI/CLI 源码或配置、创建远端 fork、请求模型、构建或发布包。文档检查用 `git diff --check`，功能未实现所以未运行构建或功能测试。
