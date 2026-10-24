# Sol Watch（小Sol的小天才手表）

> **支持范围：Chrome / Edge 桌面网页版 ChatGPT。** 目前不支持 iOS / Android 原生 App 的发送注入；在未安装本扩展的客户端中，注入的时间元数据会作为普通文本显示。

Chrome Manifest V3 扩展：在 ChatGPT 网页版显示**真实消息时间**，并把**发送时间**
以紧凑格式告诉模型。项目刻意聚焦桌面 Web DOM，不把“仅网页版”包装成全平台能力。

- 功能 A：从 ChatGPT 页面数据中读取真实的 `message.create_time`（服务端创建时间），
  在历史与新增消息旁显示时间标签。**同一账号下由 iOS 原生 App 发送的历史消息**，
  其 `create_time` 是服务端数据，网页版同样可以读取并显示。
- 功能 B：用户发送消息前，在正文最前注入一行紧凑时间元数据
  `⟦t=2026-10-23T19:53:37+08:00⟧`，让模型也能收到发送时刻。
  支持“会话锚点 / 每条消息 / 关闭”三种模式，默认会话锚点。
  **该功能仅在网页版发送消息时启用，不宣称支持 iOS 原生 App 的发送注入。**

> **重要边界**：时间元数据属于**实际消息内容**。在没有安装扩展的客户端
> （包括 iOS App）里，它会作为普通文本显示。紧凑格式和会话锚点只是减少视觉
> 臃肿与重复，**不是跨客户端隐藏**；也不承诺模型一定理解或使用该字段。

---

## 1. 安装

1. 打开 `chrome://extensions`；
2. 打开右上角 **开发者模式**（Developer mode）；
3. 点击 **加载已解压的扩展程序**（Load unpacked）；
4. 选择本项目根目录（包含 `manifest.json` 的 `sol-watch` 文件夹）；
5. 打开 https://chatgpt.com 即可使用。默认设置下：用户消息显示时间、assistant
   时间不显示、发送时间注入开启、调试行不显示、24 小时制。

> 本项目为未打包扩展，不需要 `chrome://flags` 或 Web Store 发布。

## 2. 使用

点击工具栏的 Sol Watch 图标打开设置面板：

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 在聊天界面显示时间 | 开 | 用户消息显示时间标签 |
| 同时显示 assistant 回复时间 | 关 | 给 assistant 回复也加时间标签 |
| 发送时间 | 会话锚点（推荐） | 三选一：会话锚点 / 每条消息 / 关闭（**仅网页版**） |
| 在正文中显示时间元数据调试行 | 关 | 显示被隐藏的元数据行，便于调试 |
| 12/24 小时制 | 24 小时 | 时间标签格式 |
| 调试日志 | 关 | console 输出 + 页面内环形缓冲 |

“恢复默认设置”一键还原。设置保存在浏览器本地
（`chrome.storage.local`），无账号、无云同步。

### 时间标签

- 显示为设备本地时区：`MM/DD HH:mm:ss`（24h）或 `MM/DD h:mm:ss AM/PM`（12h）；
- 低调样式（小号、半透明、不可选中），不影响复制正文；
- 读取不到可靠 `create_time` 的消息**不显示**时间——不会用安装时间或当前时间
  伪造历史记录。

### 时间元数据（功能 B）

发送到 ChatGPT 的实际消息为：

```text
⟦t=2026-10-23T19:53:37+08:00⟧
你的原始正文……
```

- `t` 由 `formatSentAt()` 生成，包含秒与本地 UTC offset；offset 已足够表达
  该时刻的本地时间，不再重复写 IANA timezone；
- 元数据独占第一行，正文从下一行开始；只使用一个换行；
- 不使用零宽字符、HTML comment、隐写或其他脆弱隐藏方案；
- 时间元数据是**实际消息内容**，没有安装扩展的客户端（包括 iOS App）会看到它；
- 旧格式 `[SOL_TIME v=1 sent_at="…" timezone="…"]` 继续识别：旧消息仍能隐藏、
  复制剥离和编辑重发；编辑/重发时旧格式会被替换为新的紧凑格式。

#### 三种发送时间模式

| 模式 | 行为 |
| --- | --- |
| 会话锚点（推荐，默认） | 当前会话在页面生命周期内首次发送、距上次成功触发发送的注入满 30 分钟、或本地日期变化时注入；编辑/重发/retry 首行已有元数据时强制替换 |
| 每条消息 | 每次发送都注入/更新时间 |
| 关闭 | 完全不注入，原样放行 |

会话锚点状态只保存在当前页面内存中，按 conversation 隔离（优先 conversation
ID，取不到时用稳定的 pathname），刷新页面后重新成为一次锚点；不存储正文、
不做云同步。不需要注入时会**完全放行 ChatGPT 原生发送**，不会先拦截再模拟。

兼容旧设置：旧字段 `tellModelSendTime=false` 迁移为“关闭”，`true` 或缺失迁移为
“会话锚点”；新字段 `sendTimeMode` 存在时以新字段为准。

- 支持 Enter、点击发送、含附件、多行文本、编辑重发，以及用户手动 retry；
- `Shift+Enter` 只换行，**不注入、不发送**；
- 同一条消息不会出现多行元数据（首行已是旧/新格式时仅替换为新的实际时间）；
- 注入失败时**不发无时间戳的原文**：恢复草稿、取消本次发送，并在页面顶部显示
  4 秒轻提示（`solwatch-send-failed`），不遮挡输入框；
- 无法触发发送动作时同样恢复草稿；但“触发发送动作”不等于网络发送成功，
  扩展不能确认服务端已接收，也不能独立检测所有网络失败；
- 不改变你原始正文的其余字符、换行和 Markdown；附件/图片/链接不会被清空。

### 元数据行的隐藏

- 发给模型的完整消息包含时间元数据（旧版称 SOL_TIME；模型可见）；
- 界面渲染后，扩展只隐藏消息**绝对开头**的第一个元数据 token（最多一个，
  新旧格式都识别）；正文后面出现的示例、引用或代码块不会被误藏；
- 兼容单文本节点、块级 `<p>`、内层 `<span>`、链接、图片、`<br>` 和零宽空段；
- 即使 `create_time` 暂时读取失败，元数据隐藏仍然生效，只是不显示时间标签；
- 复制消息正文时，只剥离剪贴板中**绝对开头**的一条元数据（`copy` 事件 capture
  拦截）；正文后面的同格式示例不会被删除；
- 关闭扩展后，页面原始消息数据保持完整，无不可逆修改；
- 不使用零宽字符/隐写。

> **已知限制**：若未来 ChatGPT 渲染机制无法安全地只隐藏开头 token，扩展会
> **保留可见的紧凑时间行**而不是做脆弱 hack，并在本 README 与
> docs/TECH_NOTES.md 中更新说明。

## 3. 权限与隐私

- 权限：仅 `storage`（保存设置）；
- 运行范围：仅 `https://chatgpt.com/*` 与 `https://chat.openai.com/*`；
- **不使用后端服务器**、**不发送任何外部网络请求**（无 fetch/XHR、无
  localhost bridge、无 analytics/telemetry/广告）；
- 不收集、存储或上传聊天正文；
- 不读取账号 token、cookie、密码或其他无关数据；
- 显示功能只读取页面已渲染的消息数据（React fiber 中的 `create_time`）；
- 注入功能会修改**发送给模型的 prompt**（在最前加入一行时间元数据）；
- 会话锚点只在内存中保存“某会话上次注入时间/日期”，不保存正文；
- 时间元数据会作为实际消息内容出现在其他客户端（包括 iOS App），扩展无法
  跨客户端隐藏；
- 所有处理均在本地浏览器完成。

## 4. 参考项目与许可

- [chatgpt-timestamp-extension](https://github.com/Hangzhi/chatgpt-timestamp-extension)
  — MIT (c) 2025 Hangzhi；本项目的 React Fiber 新版读取算法改编自它。
- [chatgpt-codex-temporal-awareness-extension](https://github.com/spolwort1970/chatgpt-codex-temporal-awareness-extension)
  — 无 LICENSE（默认保留版权）；本项目仅借鉴“发送前注入”设计思路，未复制其代码，
  且不使用其 localhost bridge。
- 详细来源与合规说明：`THIRD_PARTY_NOTICES.md`；许可证：`LICENSE`（MIT）。

## 5. 技术要点

- Manifest V3 + 原生 JavaScript/HTML/CSS，零构建链、无第三方依赖；
- **content script 运行在 `world: "MAIN"`**：React 把 Fiber 数据挂在 DOM 节点的
  `__reactFiber$…` 扩展属性上，该属性（JS expando）不跨 ISOLATED world 共享，
  必须在 MAIN world 才能读取（真实站点验证确认）；代码以 IIFE + 命名空间隔离，
  不污染页面全局；
- 模块划分：`dom-queries`（选择器收敛）、`fiber-adapter`（React Fiber 读取适配层）、
  `time-reader`（create_time 读取策略）、`metadata`（新旧格式纯函数）、
  `session-anchor`（会话锚点状态机）、`sender-hook`（发送拦截）、
  `metadata-hider`（元数据隐藏/剪贴板剥离）、`ui-overlay`（时间标签）、
  `ui-notice`（失败轻提示）、`settings`（设置与旧字段迁移）；
- 发送拦截在 `window` 的 **capture 阶段** 监听 Enter/click（早于页面自己的
  `document` handler）；contenteditable 用 Selection + `document.execCommand('insertText')`
  触发原生输入流，textarea 用 native value setter；提交前等双重 rAF + 150ms；
  注入验证失败/无法触发发送动作时 fail-closed（恢复草稿，不发送原文）；
- 不依赖固定 class name：优先语义属性（`data-turn-key`、
  `data-chatgpt-search-unit-key$`、`data-user-message-bubble` 等），
  并为不同 ChatGPT shell 保留兼容路径；
- MutationObserver 250ms 节流 + 节点粗筛（只在新增节点命中候选时扫描）；
  30s 周期轻扫兜底 + SPA pushState/replaceState/popstate/hashchange 重扫；
- 所有定时器、监听器、observer 防重复注册；React Fiber 读取独立成适配层；
- 详细机制见 `docs/TECH_NOTES.md`。

## 6. 测试

```powershell
npm test
```

- 单元测试：72 项（新旧格式构造/识别/替换/计数/剥离、旧字段迁移、
  会话锚点首次/30 分钟/跨天/会话隔离/页面生命周期/失败不占锚点/新会话 URL 切换、always/off、
  create_time 读取策略，以及 jsdom 下的编辑器定位、注入验证、失败恢复、
  设置联动、同行 `]` 隐藏、块级/链接/图片/`<br>`/零宽/顶部 margin 兼容、
  只隐藏绝对开头第一个 token、复制只剥离开头元数据、无 `create_time` 时仍隐藏、
  requestSubmit fallback 不遗留 `resumeSend`、synthetic click 未到达 window 时
  `resumeSend` 同步复位；含 America/New_York 2026 夏令时
  子进程断言、assistant-only turn、不伪造无数据消息）；
- 集成夹具：浏览器直接打开 `test/fixture/fixture.html`（file:// 即可），
  依次点击场景按钮，页面输出逐项 PASS/FAIL 与汇总（本机实测 40/40 全过）。
  覆盖：历史（含 iOS 消息）、
  点击/Enter/Shift+Enter 发送、中文/英文/Emoji/多行 Markdown、调试行、
  会话锚点/每条消息/关闭、旧格式编辑重发、assistant 开关、12/24 制、
  复制剥离（含正文后示例保留）、流式新消息、SPA 切换、重新生成、空消息、
  无时间不伪造。

## 7. 排错

| 现象 | 排查 |
| --- | --- |
| 时间标签不显示 | ① 确认设置开关开启；② 打开调试日志（设置→调试日志）后在
  `chrome://extensions` 详情页“检查视图”查看 console；③ 若消息本身没有
  `create_time`（例如会话数据缺失），按设计不显示。 |
| 发送没有注入时间元数据 | ① 确认“发送时间”不是“关闭”；② 会话锚点模式下，
  同一会话 30 分钟内、未跨天且不是编辑/重发时按设计不注入；③ 确认在
  chatgpt.com 页面（不是 iOS App / 其他客户端）；④ 看“在正文中显示时间元数据
  调试行”是否能看到首行。 |
| 复制正文带出开头元数据 | 属剪贴板剥离失败情形：确认在 chatgpt.com 页面内复制；
  若仍复现，打开调试日志复现一次并查看 console。 |
| ChatGPT 更新后失效 | 前端改版最可能影响的文件：`src/content/dom-queries.js`
  与 `src/content/fiber-adapter.js`、`time-reader.js`。观察控制台告警
  （`readFromNewShell failed` / `scan failed`），按 docs/TECH_NOTES.md 第 7 节更新。 |
| 扩展不加载 | `chrome://extensions` 页看是否报错（manifest 语法/图标缺失）。
  本项目无构建步骤，改动后回到该页点“重新加载”。 |

## 8. 已知限制

- 当前目标平台是 **Chrome / Edge 桌面网页版**（chatgpt.com / chat.openai.com）；Firefox / Safari / 移动端不在当前支持范围内；
- 只支持网页版（chatgpt.com / chat.openai.com）；**不宣称支持 iOS 原生 App 的
  发送注入**；iOS App 发送的历史消息时间（服务端 `create_time`）可在网页版正常显示；
- 时间元数据是实际消息内容，**没有安装扩展的客户端（包括 iOS App）仍会看到它**；
  会话锚点和紧凑格式只是降低干扰，不是跨客户端隐藏；
- 会话锚点状态只在当前页面内存中，刷新页面后重置；不同标签页之间不共享；
- 若页面未渲染出该消息的 `create_time`（如个别会话数据缺失），时间不显示，不伪造；
- 时间标签为只读视觉层；复制正文不含标签；
- 注入逻辑基于对 ChatGPT 当前 DOM/事件模型的观察，前端改版后需按第 7 节维护；
- 扩展只能确认“发送动作已触发”，不能确认网络请求成功或服务端已接收；
- 无后端、无账号同步，不同设备的设置各自独立。


## 9. 安全与隐私

- 隐私说明见 [`PRIVACY.md`](PRIVACY.md)。
- 安全问题请按 [`SECURITY.md`](SECURITY.md) 中的方式报告；请不要在公开 issue 中粘贴聊天内容、账号信息、cookie、token 或其他敏感数据。
