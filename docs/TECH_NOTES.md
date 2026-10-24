# Sol Watch — 技术说明（TECH NOTES）

## 1. 如何读取真实 create_time

读取策略按优先级逐级尝试，全部失败返回 `null`（**绝不伪造**）：

1. **DOM 属性兜底**：`data-create-time` / `datetime`（ChatGPT 通常不渲染，仅为兼容）；
2. **旧 shell（2024 及以前）**：沿 `__reactFiber$` 向上 ≤16 层找
   `memoizedProps.messages[0].create_time`；
3. **通用**：沿 fiber 链找携带 `message` 对象（含 `create_time`）的节点；
4. **新版 shell（2025+）**：
   - `getCommittedFiber(turn)`：从消息元素 fiber 向上定位 React root
     （tag===3、`stateNode.current`），再从 committed（非 alternate）分支重建路径，
     得到与当前渲染一致的 fiber 视图链；
   - `getTurnEntry(view, conversationId)`：向上找携带
     `props.entry.turn.items` 且 `conversationId` 匹配的节点；
   - `findLiveSnapshot(view, turnInfo)`：在 hooks/memoCache 中搜索
     `renderedConversation + renderedTurns` 的 live snapshot，并校验
     `renderedTurns` 中与本 turn 匹配唯一、且（有 userId 时）mapping 中
     用户消息角色/归属一致；
   - `resolveTurnTimestamp(unit, turnInfo, mapping, role)`：以语义单元
     `data-chatgpt-search-unit-key$=":role"` 与 `data-chatgpt-search-message-ids`
     定位消息 id，在 `mapping[id].message.create_time` 取时间；
     assistant 优先 `phase === 'final_answer'` 且 `latestMessageId` 匹配的消息。

iOS 原生 App 发送的历史消息：`create_time` 是**服务端字段**，网页版加载同一会话时
数据相同，上述第 4 级路径天然覆盖。

角色判定：新版 shell 按 bubble 语义属性（`data-user-message-bubble` /
`data-markdown-text-style="assistant-message"`），旧 shell 按
`data-message-author-role`，再退化为 fiber 上 `author.role`（宽松查找，不要求
create_time 存在）。

## 2. 如何拦截发送

`sender-hook.js` 在 `window` 上以 **capture 阶段** 监听 `keydown` / `click`，
保证早于页面自己的 `document` capture handler：

- **Enter 发送**：`e.key === 'Enter'` 且非 `shiftKey` / `isComposing` /
  `altKey` / `ctrlKey` / `metaKey`，编辑器非空，且当前模式判断需要注入 → 拦截；
  不需要注入则直接放行原生 Enter；
- **点击发送按钮**：`target.closest(提交按钮候选)`（`data-testid*="send"`、
  `aria-label` 中英、`type="submit"`），且当前模式判断需要注入 → 拦截；
  不需要注入则直接放行原生 click；
- 拦截前先按 `sendTimeMode` 判断；不需要注入时**完全放行**原生发送：
  - `off`：永不注入；
  - `always`：每条注入；
  - `session`：首行已有元数据（编辑/重发/retry）→ 注入；否则按会话锚点判断
    （首次、满 30 分钟、跨本地日期才注入）。状态在 `session-anchor.js` 内存中，
    按 conversation ID / pathname 隔离，刷新页面重置。
- 拦截后 `preventDefault + stopImmediatePropagation`，异步执行：
  1. 读编辑器当前文本；空 → 放行；
  2. 生成紧凑时间元数据行并注入：
     - contenteditable / ProseMirror：Selection + `document.execCommand('insertText')`，
       触发原生 `beforeinput`/`input`，让 React/ProseMirror 内部 state 同步；
     - textarea：native value setter + `InputEvent('input')`；
  3. 验证注入结果：`execCommand` 返回 true、元数据 token 存在、原正文未被吞掉；
  4. `waitForComposerCommit()`：**双重 rAF + 150ms setTimeout 兜底**——
     解决后台/不可见标签页 rAF 挂起导致发送永久卡住的问题；
  5. 恢复发送：`button.click()`；没有可用按钮时 `form.requestSubmit()` fallback。
     发送动作成功触发后记录会话锚点；这不代表网络请求成功。
- `Shift+Enter` 直接放行（只换行）；IME 组合（`isComposing`）放行；
- `pendingSend` 防并发；`resumeSend` 只用于放行发送按钮恢复后的第二次 click：
  `btn.click()` 是同步派发，拦截器吞掉它会当场复位；若事件未到达 window
  capture（按钮被移出文档、被更早的 capture handler 吞掉），`triggerSend`
  在 `click()` 返回后立即同步复位，绝不把状态留给下一次真实用户操作；
  `requestSubmit()` fallback 完全不设置它，否则会放行下一条未注入的消息。

**fail-closed**：注入验证失败或发送动作未触发时，恢复草稿、取消本次发送，并派发
`solwatch-send-failed`；`ui-notice` 在页面顶部显示 4 秒轻提示（不接收鼠标事件、
不遮挡输入框），绝不发送没有时间戳的原文。显示侧读取失败仍 fail-open：
读不到 `create_time` 就不显示标签，不影响聊天本身。

### 会话锚点状态机（`session-anchor.js`）

- key：优先 `dom.getConversationId()`（URL `/c/<id>` 或 DOM 属性），
  取不到时用 `location.pathname`；状态为内存 `Map`，刷新页面即清空；
- `shouldInject(session, key, hasMetadata)`：
  1. 首行已有旧/新元数据（编辑/重发/retry）→ 注入；
  2. 该 key 没有锚点 → 注入；
  3. 本地日期与锚点日期不同 → 注入；
  4. `now - anchor.at >= 30 分钟` → 注入；
  5. 否则不注入，`sender-hook` 直接放行原生发送；
- `markInjected(key)` 只在发送动作成功触发后调用；注入失败/无法触发发送不更新锚点；
  新会话发送后 URL 从 pathname fallback 变成 `/c/<id>` 时，发送前后的两个 key 都记录，
  避免下一条被误判为首次发送；
- 不保存正文，不写 storage，不做云同步；
- 旧设置迁移：`tellModelSendTime=false` → `off`，`true`/缺失 → `session`；
  合法 `sendTimeMode` 存在时优先，写入时会移除旧字段。

## 3. 如何防止重复注入

- `metadata.injectOrReplaceSolTime` 若首行已是旧版或新版元数据（正则校验 token），
  则**只替换该行为新的紧凑格式**，其余正文逐字不动；旧版双换行会顺手收成单换行。
  否则在最前插入 `line + 单个换行 + original`（保留原文 CRLF/LF 风格），
  单个换行避免链接/图片消息多渲染空段落；
- `countSolTimeLines(text)` 同时统计旧/新格式，任何入口均可复核行数；
- 编辑/重发/retry 复用同一路径 → 旧时间被覆盖，不会出现多行；
- `stripLeadingSolTime` 只删除绝对开头的一条元数据及注入换行，正文后部的同格式
  示例/引用/代码块保持原样；`stripSolTimeLines` 是它的兼容别名。

## 4. 如何隐藏已渲染的元数据

`metadata-hider.js`：

- 只在消息**绝对开头**找第一个可见文本节点：允许前导空白/零宽字符，但该节点
  必须直接以旧版或新版元数据 token 开头，且它之前不能已有图片/视频等真实内容；
- 找到后用 `splitText` 把元数据 token（连同前导空白和紧随的换行）拆出，包进
  `display:none` 的 span + `data-solwatch-hidden="1"`（可逆）；一次最多隐藏一个；
- 正文后面出现的旧版/新版示例、引用或代码块不会被当成元数据（旧实现会遍历
  所有文本节点，已修正）；
- 元数据独占一段时隐藏整段，并清掉注入换行产生的空段/前导 `<br>`；第一个可见块
  标记 `data-solwatch-first-visible`，由 CSS 去掉 `margin-top`，避免顶部空白；
- `showSolTimeLine` 反向恢复（调试行开关）；
- `applyToContainer` 按设置统一应用；找不到可隐藏的绝对开头 token 时返回 `false`，
  不动正文；
- **剪贴板剥离**：`document` capture 监听 `copy`，只有选区/事件文本**绝对开头**
  是旧/新元数据时才 `preventDefault` 并写入剥离后的纯文本；正文后部的示例保留
  （构造事件场景写回 `clipboardData`；真实浏览器 fallback
  `navigator.clipboard.writeText`）。

只改样式与剪贴板数据，**不改页面数据**；扩展关闭后消息数据保持原样。

## 5. 渲染与扫描

`main.js`：

- `MutationObserver` **250ms 节流** + addedNodes 粗筛（仅在新增节点命中消息候选
  时调度扫描，避免流式输出的每次字符都全页扫描）；单次扫描带 600ms 死循环保护；
- SPA：wrap `history.pushState` / `replaceState` + `popstate` / `hashchange` 触发
  400ms 重扫；30s 周期轻扫兜底（懒加载/离线缓存恢复）；
- 设置变更：`chrome.storage.onChanged` → `applySettings`（清空旧标签 + 重扫）；
- 每个用户 turn 先执行元数据隐藏、再读取 `create_time`：时间读取失败只影响标签，
  不会让时间元数据露出来；
- 全链路幂等：init、observer、监听器、标签插入均有重复保护。

## 6. 时间元数据格式

### 新版紧凑格式（发送时使用）

```text
⟦t=2026-10-23T19:53:37+08:00⟧
```

- `t` 在发送动作触发时由 `formatSentAt()` 生成，包含秒与本地 UTC offset
  （`formatUtcOffset` 由 `-getTimezoneOffset()` 导出，含夏令时正确符号）；
- UTC offset 已足够表达该时刻的本地时间，不再写 IANA timezone，也去掉 `v=1`
  和 `sent_at=` 冗余字段；
- token 独占第一行，正文从下一行开始，只用单个换行；
- 时间标签仍用设备本地时区 `MM/DD HH:mm:ss`（24h）或
  `MM/DD h:mm:ss AM/PM`（12h），与元数据格式无关。

### 旧版格式（只读兼容）

```text
[SOL_TIME v=1 sent_at="YYYY-MM-DDTHH:mm:ss±HH:MM" timezone="<IANA>"]
```

旧消息仍能被识别、隐藏、复制剥离；编辑/重发/retry 时会被替换为新版紧凑格式，
不会保留旧时间。新版与旧版都由 `metadata.js` 的同一组正则识别。

## 7. ChatGPT 前端更新后最可能失效的位置

> 运行模型：content script 使用 `world: "MAIN"`。原因：React 17+ 把 fiber 挂在
> DOM 节点的 `__reactFiber$…` expando 属性上；扩展的 ISOLATED world 拥有独立的
> JS 包装对象，**读不到 MAIN world 在 DOM 节点上设置的 expando 属性**（真实站点
> 验证确认 `fiberKey: absent`），因此必须在 MAIN world 运行才能读取真实数据。
> 代码全部用 IIFE + `SolWatch*` 命名空间隔离，避免与页面全局冲突。

| 失效征兆 | 最可能位置 | 修复方向 |
| --- | --- | --- |
| 找不到消息候选 | `dom-queries.MESSAGE_CANDIDATE_SELECTOR` | 更新 turn/message 语义属性 |
| 新 shell 读不到时间 | `fiber-adapter.getTurnEntry` / `findLiveSnapshot` | entry/turn 结构变化，或 snapshot 不再挂 hooks/memoCache |
| assistant 时间取不到 | `time-reader.resolveTurnTimestamp` | `phase`/`latestMessageId` 字段变化 |
| 发送不拦截 | `sender-hook` 的按钮/编辑器候选、`dom-queries` 提交按钮选择器 | 按钮语义属性/编辑器标签变化 |
| 会话锚点模式不按预期注入 | `session-anchor.js` | 检查 conversation key、30 分钟/跨天规则，以及是否只有“发送动作成功触发”才更新锚点 |
| 元数据行隐藏失败 | `metadata-hider.findSolTimeTextNodes` / `hideSolTimeLine` | 消息文本渲染块结构变化；确认元数据仍是消息绝对开头的第一个 token |

调试：设置面板开启“调试日志”，在扩展详情页“检查视图”看 console（前缀
`[SolWatch]`）；夹具页面右侧有 `solwatch-trace` 环形缓冲与发送 payload 日志。

## 8. 验证结果（本机实测）

- 单元测试 `node test/run-tests.mjs`（或 `npm test`）：**72 passed, 0 failed**；
- 集成夹具（浏览器打开 `test/fixture/fixture.html`）：**40/40 全部通过**，
  覆盖：历史用户时间（含 iOS 原生 App 消息 09/30 21:30:00）、assistant 开关、
  点击/Enter 注入、Shift+Enter 仅换行、调试行开关、会话锚点/每条消息/关闭、
  旧格式编辑重发升级、12/24 制、复制只剥离开头元数据、流式新消息自动加标签、
  SPA 切换重扫、重新生成更新标签、空消息不发送、无 create_time 不伪造；
- **真实 chatgpt.com 站点验证（使用已登录测试账号实测）**：
  - DOM 基线全部命中：`[data-turn-key]`=5、`[data-user-message-bubble]`=5、
    `[data-markdown-text-style="assistant-message"]`=5、
    `[data-chatgpt-search-unit-key]`=10（值形如 `fallback-turn-0:0:user`，
    以 `:user` 结尾，与 `[data-chatgpt-search-unit-key$=":user"]` 选择器匹配）、
    `[data-chatgpt-search-message-ids]`=10；
  - `section[data-turn-id]` / `div[data-message-id]` / `[data-message-author-role]`
    为 0（新版 shell 已废弃，选择器保留为兼容路径）；
  - 确认 ISOLATED world 读不到 `__reactFiber$` expando → 已将 content script
    改为 `world: "MAIN"`；
  - 端到端（时间标签真实渲染 + 发送注入）最终确认：按 README 安装后在真实
    会话复核（验收清单见 README 第 6 节）。
