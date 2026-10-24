# Third-Party Notices（第三方来源说明）

本项目（Sol Watch）是整合两个开源项目思路的独立实现。为避免侵权，特此说明
来源、许可证与使用范围。**除下列说明外，本项目代码全部为原创编写。**

---

## 1. chatgpt-timestamp-extension

- 仓库：https://github.com/Hangzhi/chatgpt-timestamp-extension
- 作者：Hangzhi
- 许可证：MIT（Copyright (c) 2025 Hangzhi，已核对仓库 LICENSE 文件全文）
- 用途：**改编**（代码算法级借鉴后重写）
  - `src/content/fiber-adapter.js`：
    - `getCommittedFiber`（committed fiber 定位与路径重建）
    - `getTurnEntry`（entry/turn/items 定位）
    - `findLiveSnapshot`（hooks/memoCache 中搜索 renderedConversation 快照）
  - `src/content/time-reader.js` 的“新版 shell”读取路径：
    - `getSemanticUnit` / `getUnitMessageIds` / `getTypedItemIds` /
      `getMessageTimestamp` / `resolveTurnTimestamp`
  - 语义属性基线：`data-chatgpt-search-unit-key$`、`data-chatgpt-search-message-ids`、
    `data-turn-key`、`data-user-message-bubble`、
    `data-markdown-text-style="assistant-message"` 等
- 兼容性：保留 MIT 许可证义务，本文件头部与 LICENSE 中均已注明版权与来源；
  本项目 LICENSE 为 MIT，符合原项目授权条件。

## 2. chatgpt-codex-temporal-awareness-extension

- 仓库：https://github.com/spolwort1970/chatgpt-codex-temporal-awareness-extension
- 许可证：**仓库内未提供 LICENSE 文件**（依据默认版权规则，代码不可复制）
- 用途：**仅借鉴设计思路，未复制任何代码**
  - “发送前捕获 → 注入时间元数据 → 恢复发送”的整体设计
  - 注入后双 rAF 等待 React 提交、dedupe 防重复等防御思想
- 明确不采用的部分：
  - 其 `context-client` 依赖 `http://127.0.0.1:4317` 的 localhost bridge，
    本项目按隐私要求**完全不使用**任何本地服务/桥接。
- 归属：在本文件与 README “参考项目”一节说明，其设计思路不受许可证限制。

---

## 合规承诺

- 未复制 codex-temporal 的任何代码行；
- 对 timestamp 项目的改编均保留原 MIT 版权声明与许可文本；
- 本项目全部实现（除上述改编部分外）为原创；
- 不使用后端、不依赖 localhost bridge、不发送任何外部网络请求。
