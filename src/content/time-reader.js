/**
 * Sol Watch — time-reader
 * 读取消息的“真实服务端创建时间”（create_time）。策略按优先级：
 *   1) DOM 属性兜底（data-create-time / datetime）——ChatGPT 通常不渲染，仅为兼容保留；
 *   2) 旧 shell：fiber.memoizedProps.messages[0].create_time；
 *   3) 通用：fiber 上携带 message（含 create_time）的对象；
 *   4) 新 shell（2025+）：entry/turn + live snapshot(mapping) → mapping[id].message.create_time。
 * 取不到可靠时间一律返回 null——不安装时间、不伪造历史。
 *
 * 新 shell 解析逻辑来源：chatgpt-timestamp-extension（MIT, Copyright (c) 2025 Hangzhi），
 * 使用与归属说明见 THIRD_PARTY_NOTICES.md。
 */
(function (root, factory) {
  const api = factory(
    (typeof window !== 'undefined' && window.SolWatchDomQueries) ||
    (typeof require === 'function' ? require('./dom-queries.js') : null),
    (typeof window !== 'undefined' && window.SolWatchFiberAdapter) ||
    (typeof require === 'function' ? require('./fiber-adapter.js') : null),
    (typeof window !== 'undefined' && window.SolWatchTimeFormat) ||
    (typeof require === 'function' ? require('../common/time-format.js') : null),
    (typeof window !== 'undefined' && window.SolWatchLogger) ||
    (typeof require === 'function' ? require('../common/logger.js') : null)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchTimeReader = api;
})(typeof window !== 'undefined' ? window : null, function (dom, fiber, timeFormat, logger) {
  'use strict';

  const log = logger || { debug() {}, warn() {}, error() {} };
  const own = (o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)) ? o[k] : undefined;

  /** 1) DOM 属性兜底 */
  function readFromDomAttributes(element) {
    if (!element) return null;
    const holder = element.closest ? (element.closest('[data-create-time]') || element) : element;
    const attr = holder.getAttribute && holder.getAttribute('data-create-time');
    if (attr != null && attr !== '') return timeFormat.normalizeTimestamp(attr);
    if (element.getAttribute && element.getAttribute('datetime')) {
      return timeFormat.normalizeTimestamp(element.getAttribute('datetime'));
    }
    return null;
  }

  /** 2) 旧 shell：messages 数组 */
  function readFromMessagesProp(element, role) {
    const messages = fiber.findMessagesProp(element);
    if (!messages) return null;
    const msg = messages[0];
    if (role && msg.author && msg.author.role !== role) return null;
    return timeFormat.normalizeTimestamp(msg.create_time);
  }

  /** 3) 通用：message 对象 */
  function readFromMessageProp(element, role) {
    const msg = fiber.findMessageProp(element);
    if (!msg) return null;
    if (role && msg.author && msg.author.role !== role) return null;
    return timeFormat.normalizeTimestamp(msg.create_time);
  }

  // —— 4) 新版 shell ——

  function getSemanticUnit(turn, role) {
    return turn.querySelector(`[data-chatgpt-search-unit-key$=":${role}"][data-chatgpt-search-message-ids]`);
  }

  function getUnitMessageIds(unit) {
    const value = (unit && unit.getAttribute && unit.getAttribute('data-chatgpt-search-message-ids')) || '';
    return [...new Set(value.trim().split(/\s+/).filter(Boolean))];
  }

  function getTypedItemIds(item, role) {
    const keys = role === 'user' ? ['messageId', 'serverMessageId'] : ['messageId', 'latestMessageId'];
    return [...new Set(keys.map((k) => own(item, k)).filter((id) => typeof id === 'string' && id))];
  }

  function getMessageTimestamp(mapping, id, role) {
    const node = own(mapping, id);
    const message = own(node, 'message');
    if (own(node, 'id') !== id || own(message, 'id') !== id ||
        own(own(message, 'author'), 'role') !== role) return null;
    return timeFormat.normalizeTimestamp(own(message, 'create_time'));
  }

  function resolveTurnTimestamp(unit, turnInfo, mapping, role) {
    if (!unit) return null;
    const unitIds = getUnitMessageIds(unit);
    if (!unitIds.length) return null;

    let typedItems;
    if (role === 'user') {
      typedItems = [turnInfo.userItem];
    } else {
      typedItems = turnInfo.items.filter((item) => own(item, 'type') === 'assistant-message');
    }
    const selEl = unit.querySelector('[data-chatgpt-selection-message-id]');
    const selectionId = selEl && selEl.getAttribute && selEl.getAttribute('data-chatgpt-selection-message-id');
    const usableSelectionId = selectionId && unitIds.includes(selectionId) ? selectionId : null;

    const candidates = [];
    for (const item of typedItems) {
      const matchingIds = getTypedItemIds(item, role).filter((id) => unitIds.includes(id));
      for (const id of matchingIds) {
        candidates.push({ id, finalAnswer: own(item, 'phase') === 'final_answer', selected: id === usableSelectionId });
      }
    }
    if (!candidates.length) return null;

    const resolved = candidates
      .map((c) => ({ ...c, timestamp: getMessageTimestamp(mapping, c.id, role) }))
      .filter((c) => c.timestamp != null);
    if (!resolved.length) return null;
    const finalAnswers = resolved.filter((c) => c.finalAnswer);
    const preferred = role === 'assistant' && finalAnswers.length ? finalAnswers : resolved;
    const selected = preferred.filter((c) => c.selected);
    const chosen = selected.length ? selected : preferred;
    const ids = [...new Set(chosen.map((c) => c.id))];
    return ids.length === 1 ? chosen[0].timestamp : null;
  }

  function readFromNewShell(turn, conversationId, role) {
    try {
      const committedFiber = fiber.getCommittedFiber(turn);
      if (!committedFiber) return null;
      const turnInfo = fiber.getTurnEntry(committedFiber, conversationId);
      if (!turnInfo) return null;

      if (role === 'user') {
        const userItems = turnInfo.items.filter((item) => own(item, 'type') === 'user-message');
        if (userItems.length !== 1) return null;
        turnInfo.userItem = userItems[0];
        turnInfo.userId = own(turnInfo.userItem, 'messageId') || own(turnInfo.userItem, 'serverMessageId');
        if (typeof turnInfo.userId !== 'string' || !turnInfo.userId) return null;
      } else {
        turnInfo.userItem = null;
        turnInfo.userId = null;
      }

      const live = fiber.findLiveSnapshot(committedFiber, turnInfo);
      if (!live || !live.mapping) return null;

      return resolveTurnTimestamp(getSemanticUnit(turn, role), turnInfo, live.mapping, role);
    } catch (err) {
      log.warn('readFromNewShell failed', err);
      return null;
    }
  }

  /**
   * 读取某消息元素的 create_time。
   * @param {Element} element 消息元素（turn 或 message div）
   * @param {string|null} role 'user' | 'assistant' | null（不确定时传 null）
   * @returns {number|null} Unix 秒；无可靠数据返回 null。
   */
  function readCreateTime(element, role) {
    if (!element) return null;
    try {
      const domTs = readFromDomAttributes(element);
      if (domTs != null) return domTs;

      const fromMessages = readFromMessagesProp(element, role);
      if (fromMessages != null) return fromMessages;

      const fromMessage = readFromMessageProp(element, role);
      if (fromMessage != null) return fromMessage;

      const conversationId = dom.getConversationId();
      if (conversationId) {
        const fromNewShell = readFromNewShell(element, conversationId, role || 'user');
        if (fromNewShell != null) return fromNewShell;
      }
      return null;
    } catch (err) {
      log.warn('readCreateTime failed', err);
      return null;
    }
  }

  /** 从 fiber 上取 author.role（DOM 无法判断时使用）。宽松查找：不要求 create_time 存在。 */
  function readRoleFromFiber(element) {
    const fiberKey = fiber.getFiberKey(element);
    if (!fiberKey) return null;
    let node = fiber.ownValue(element, fiberKey);
    for (let i = 0; i < 24 && node; i++) {
      const props = fiber.ownValue(node, 'memoizedProps');
      const message = fiber.ownValue(props, 'message');
      if (message && message.author &&
          (message.author.role === 'user' || message.author.role === 'assistant')) {
        return message.author.role;
      }
      const messages = fiber.ownValue(props, 'messages');
      if (Array.isArray(messages) && messages[0] && messages[0].author &&
          (messages[0].author.role === 'user' || messages[0].author.role === 'assistant')) {
        return messages[0].author.role;
      }
      node = fiber.ownValue(node, 'return');
    }
    return null;
  }

  return { readCreateTime, readRoleFromFiber };
});
