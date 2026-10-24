/**
 * Sol Watch — fiber-adapter
 * 对 React Fiber 的读取封装成独立适配层。前端结构变化时只需修本文件。
 *
 * 机制来源：chatgpt-timestamp-extension（MIT License, Copyright (c) 2025 Hangzhi，
 * https://github.com/Hangzhi/chatgpt-timestamp-extension）。本文件在保留其核心算法
 * （committed fiber 定位、live snapshot 搜索）的基础上做了防御性加固与少量重构，
 * 使用与归属说明见 THIRD_PARTY_NOTICES.md。
 */
(function (root, factory) {
  const api = factory(
    (typeof window !== 'undefined' && window.SolWatchLogger) ||
    (typeof require === 'function' ? require('../common/logger.js') : null)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchFiberAdapter = api;
})(typeof window !== 'undefined' ? window : null, function (logger) {
  'use strict';

  const log = logger || { debug() {}, warn() {}, error() {} };

  function ownValue(object, key) {
    if (!object || typeof object !== 'object' || !Object.prototype.hasOwnProperty.call(object, key)) {
      return undefined;
    }
    return object[key];
  }

  function getFiberKey(element) {
    if (!element) return null;
    const keys = Object.keys(element);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].startsWith('__reactFiber$')) return keys[i];
      if (keys[i].startsWith('__reactInternalInstance$')) return keys[i]; // React 17 兼容
    }
    return null;
  }

  /**
   * 沿 fiber.return 链向上查找，定位 root（tag === 3, stateNode.current），
   * 再从 committed（非 alternate）分支重建路径，返回 committed 分支末端的视图。
   * 找不到返回 null。
   */
  function getCommittedFiber(domNode) {
    const fiberKey = getFiberKey(domNode);
    if (!fiberKey) return null;

    const originalPath = [];
    const seen = new Set();
    let fiber = ownValue(domNode, fiberKey);
    let root = null;

    for (let depth = 0; fiber && depth < 400; depth++) {
      if (seen.has(fiber)) return null;
      seen.add(fiber);
      originalPath.push(fiber);
      if (ownValue(fiber, 'tag') === 3) {
        const rootState = ownValue(fiber, 'stateNode');
        const current = ownValue(rootState, 'current');
        if (current === fiber || current === ownValue(fiber, 'alternate')) {
          root = { fiber, state: rootState, current };
          break;
        }
      }
      fiber = ownValue(fiber, 'return');
    }
    if (!root) return null;

    // 沿 committed（非 alternate）分支重建路径
    const committedPath = [root.current];
    let committedParent = root.current;
    let work = 0;
    for (let pathIndex = originalPath.length - 2; pathIndex >= 0; pathIndex--) {
      const wanted = originalPath[pathIndex];
      const alternate = ownValue(wanted, 'alternate');
      const siblingSeen = new Set();
      const matches = [];
      let child = ownValue(committedParent, 'child');
      for (let siblings = 0; child && siblings < 1024; siblings++) {
        if (++work > 4096 || siblingSeen.has(child)) return null;
        siblingSeen.add(child);
        if (child === wanted || child === alternate) matches.push(child);
        child = ownValue(child, 'sibling');
      }
      if (child || matches.length !== 1) return null;
      committedParent = matches[0];
      committedPath.push(committedParent);
    }

    if (ownValue(root.state, 'current') !== root.current) return null;

    const views = committedPath.map((f) => ({
      memoizedProps: ownValue(f, 'memoizedProps'),
      memoizedState: ownValue(f, 'memoizedState'),
      updateQueue: ownValue(f, 'updateQueue'),
      return: null
    }));
    for (let i = 1; i < views.length; i++) views[i].return = views[i - 1];
    return views[views.length - 1];
  }

  /**
   * 从 committed fiber 向上找 “turn entry”（含 entry/turn/items，conversationId 匹配）。
   * 新版 shell 的时间数据位于 store 快照（renderedConversation.mapping），需要 entry 定位。
   */
  function getTurnEntry(committedFiber, conversationId) {
    let fiber = committedFiber;
    const seen = new Set();
    for (let depth = 0; fiber && depth < 32; depth++) {
      if (seen.has(fiber)) return null;
      seen.add(fiber);
      const props = fiber.memoizedProps;
      const entry = ownValue(props, 'entry');
      const turn = ownValue(entry, 'turn');
      const items = ownValue(turn, 'items');
      if (Array.isArray(items) && ownValue(entry, 'conversationId') === conversationId) {
        const entryId = ownValue(entry, 'id');
        if (typeof entryId !== 'string' || !entryId) return null;
        return { entry, turn, items };
      }
      fiber = fiber.return;
    }
    return null;
  }

  function isSnapshotCandidate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.prototype.hasOwnProperty.call(value, 'renderedConversation') &&
      Object.prototype.hasOwnProperty.call(value, 'renderedTurns');
  }

  /**
   * 在 React hooks / memo cache 中搜索“live snapshot”（renderedConversation + renderedTurns），
   * 并校验其 mapping 与 entry 匹配。这是新版 shell 读取 create_time 的关键路径。
   */
  function findLiveSnapshot(committedFiber, turnInfo) {
    const candidates = [];
    let remaining = 2048;

    const addCandidate = (value) => { if (isSnapshotCandidate(value)) candidates.push(value); };

    const inspectMemoCache = (memoData) => {
      if (!Array.isArray(memoData) || memoData.length > 32) return true;
      for (const row of memoData) {
        if (!Array.isArray(row) || row.length > 1024) continue;
        for (const value of row) {
          if (--remaining < 0) return false;
          addCandidate(value);
        }
      }
      return true;
    };

    const seenFibers = new Set();
    let owner = committedFiber;
    owners:
    for (let depth = 0; owner && depth < 400; depth++, owner = owner.return) {
      if (seenFibers.has(owner)) return null;
      seenFibers.add(owner);
      if (ownValue(owner.memoizedProps, 'conversationId') !== turnInfo.entry.conversationId) continue;

      let hook = owner.memoizedState;
      const seenHooks = new Set();
      while (hook && remaining > 0) {
        if (seenHooks.has(hook)) return null;
        seenHooks.add(hook);
        remaining--;
        const state = ownValue(hook, 'memoizedState');
        addCandidate(state);
        if (Array.isArray(state)) addCandidate(state[0]);
        hook = ownValue(hook, 'next');
      }
      if (hook || remaining <= 0) break owners;

      const updateQueue = owner.updateQueue;
      const memoCache = ownValue(updateQueue, 'memoCache');
      const memoData = ownValue(memoCache, 'data');
      if (!inspectMemoCache(memoData)) break owners;
    }

    const valid = [];
    for (const snapshot of candidates) {
      const renderedConversation = ownValue(snapshot, 'renderedConversation');
      const renderedTurns = ownValue(snapshot, 'renderedTurns');
      const mapping = ownValue(renderedConversation, 'mapping');
      if (!mapping || typeof mapping !== 'object' || !Array.isArray(renderedTurns)) continue;

      const matchingTurns = renderedTurns.filter((turn) =>
        ownValue(turn, 'id') === ownValue(turnInfo.entry, 'id') &&
        ownValue(turn, 'turn') === turnInfo.turn
      );
      if (matchingTurns.length !== 1) continue;

      // 有 userId 时校验 mapping 中的用户消息归属同一会话；
      // 无 userId（assistant-only turn）时跳过该项，renderedTurns 匹配已足够。
      if (turnInfo.userId) {
        const userNode = ownValue(mapping, turnInfo.userId);
        const userMessage = ownValue(userNode, 'message');
        if (ownValue(userNode, 'id') !== turnInfo.userId ||
            ownValue(userMessage, 'id') !== turnInfo.userId ||
            ownValue(ownValue(userMessage, 'author'), 'role') !== 'user') continue;
      }
      valid.push({ snapshot, mapping, renderedConversation });
    }
    if (!valid.length) return null;

    const firstMapping = valid[0].mapping;
    if (valid.some((c) => c.mapping !== firstMapping)) return null;
    const currentNodeValues = valid
      .map((c) => ({ present: Object.prototype.hasOwnProperty.call(c.renderedConversation, 'current_node'), value: ownValue(c.renderedConversation, 'current_node') }))
      .filter((c) => c.present);
    if (currentNodeValues.some((c) => !Object.is(c.value, currentNodeValues[0].value))) return null;
    return { mapping: firstMapping };
  }

  /**
   * 轻量策略：沿 fiber.return 向上（≤16 层）找 memoizedProps.messages[0]（旧 shell）。
   */
  function findMessagesProp(element, maxDepth) {
    const fiberKey = getFiberKey(element);
    if (!fiberKey) return null;
    let node = ownValue(element, fiberKey);
    const depth = maxDepth || 16;
    for (let i = 0; i < depth && node; i++) {
      const messages = ownValue(node, 'memoizedProps') && ownValue(node.memoizedProps, 'messages');
      if (Array.isArray(messages) && messages.length && messages[0] && messages[0].create_time != null) {
        return messages;
      }
      node = ownValue(node, 'return');
    }
    return null;
  }

  /**
   * 轻量策略：沿 fiber.return 向上（≤16 层）找携带 message（含 create_time）的 fiber。
   */
  function findMessageProp(element, maxDepth) {
    const fiberKey = getFiberKey(element);
    if (!fiberKey) return null;
    let node = ownValue(element, fiberKey);
    const depth = maxDepth || 16;
    for (let i = 0; i < depth && node; i++) {
      const props = ownValue(node, 'memoizedProps');
      const message = ownValue(props, 'message');
      if (message && typeof message === 'object' && message.create_time != null) {
        return message;
      }
      node = ownValue(node, 'return');
    }
    return null;
  }

  return {
    ownValue,
    getFiberKey,
    getCommittedFiber,
    getTurnEntry,
    findLiveSnapshot,
    findMessagesProp,
    findMessageProp,
    log
  };
});
