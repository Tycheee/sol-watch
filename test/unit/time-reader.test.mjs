/**
 * Sol Watch — 单元测试：time-reader
 * 通过 createRequire 以 CommonJS 加载模块（ESM 中无 require），并构造
 * 迷你 React Fiber 树 + 语义 DOM，覆盖 4 级读取策略与 assistant-only 修复。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// 提供 window.location 以便 dom.getConversationId 返回会话 id（新 shell 路径）
globalThis.window = { location: { pathname: '/c/c1' } };

const timeReader = require('../../src/content/time-reader.js');

const USER_TS = 1767180600;          // 2026-09-30T21:30:00+08:00
const ASST_TS = 1767182400;          // 2026-10-01T01:00:00+08:00 附近

/* ---------- helpers ---------- */

function fakeEl(attrs, children) {
  return {
    attrs: attrs || {},
    children: children || [],
    parent: null,
    matches() { return false; },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = v; },
    style: {},
    contains() { return false; }
  };
}

function fiber(props, opts) {
  const f = {
    tag: (opts && opts.tag) || 0,
    memoizedProps: props || {},
    memoizedState: (opts && opts.state) || null,
    updateQueue: (opts && opts.updateQueue) || null,
    alternate: (opts && opts.alternate) || null,
    return: (opts && opts.return) || null,
    child: (opts && opts.child) || null,
    sibling: null,
    stateNode: (opts && opts.stateNode) || null
  };
  if (f.child) f.child.return = f;
  return f;
}

/** 构造 leaf → … → root 的 fiber 链并挂到 element 上 */
function mountChain(element, chain) {
  const root = fiber({}, { tag: 3, stateNode: {} });
  root.stateNode.current = root;
  let parent = root;
  for (const node of chain) {
    node.return = parent;
    parent.child = node;
    parent = node;
  }
  element['__reactFiber$test'] = parent; // leaf
  return root;
}

/* ---------- tests ---------- */

export const name = 'time-reader';
export const tests = [
  {
    name: '策略1：DOM 属性 data-create-time 兜底',
    fn() {
      const el = fakeEl({ 'data-create-time': String(USER_TS) });
      const r = timeReader.readCreateTime(el, 'user');
      return r === USER_TS ? null : `got ${r}`;
    }
  },
  {
    name: '策略2：旧 shell messages prop（memoizedProps.messages[0].create_time）',
    fn() {
      const el = fakeEl({});
      const msgFiber = fiber({ messages: [{ author: { role: 'user' }, create_time: USER_TS }] });
      mountChain(el, [msgFiber]);
      const r = timeReader.readCreateTime(el, 'user');
      return r === USER_TS ? null : `got ${r}`;
    }
  },
  {
    name: '策略3：通用 message prop（fiber 携带 message 对象）',
    fn() {
      const el = fakeEl({});
      const msgFiber = fiber({ message: { id: 'm1', author: { role: 'user' }, create_time: USER_TS } });
      mountChain(el, [msgFiber]);
      const r = timeReader.readCreateTime(el, 'user');
      return r === USER_TS ? null : `got ${r}`;
    }
  },
  {
    name: '策略4：新 shell user turn（entry + live snapshot mapping）',
    fn() {
      const userItem = { type: 'user-message', messageId: 'mid1', serverMessageId: 'mid1' };
      const turnObj = { id: 'e1', items: [userItem] };
      const entry = { id: 'e1', conversationId: 'c1', turn: turnObj };
      const snapshot = {
        renderedConversation: {
          current_node: 'mid1',
          mapping: {
            mid1: { id: 'mid1', message: { id: 'mid1', author: { role: 'user' }, create_time: USER_TS } }
          }
        },
        renderedTurns: [{ id: 'e1', turn: turnObj }]
      };
      const unit = fakeEl({
        'data-chatgpt-search-unit-key$': ':user',
        'data-chatgpt-search-message-ids': 'mid1'
      });
      const turnEl = fakeEl({});
      turnEl.querySelector = (sel) => sel.includes('":user"') ? unit : null;

      const entryFiber = fiber({ entry });
      const holderFiber = fiber({ conversationId: 'c1' }, { state: { memoizedState: snapshot, next: null } });
      const midFiber = fiber({});
      mountChain(turnEl, [entryFiber, holderFiber, midFiber]);

      const r = timeReader.readCreateTime(turnEl, 'user');
      return r === USER_TS ? null : `got ${r}`;
    }
  },
  {
    name: '策略4：新 shell assistant-only turn（userId 缺失时跳过校验，读 assistant 时间）',
    fn() {
      const asstItem = { type: 'assistant-message', messageId: 'aid1', latestMessageId: 'aid1', phase: 'final_answer' };
      const turnObj = { id: 'e2', items: [asstItem] };
      const entry = { id: 'e2', conversationId: 'c1', turn: turnObj };
      const snapshot = {
        renderedConversation: {
          current_node: 'aid1',
          mapping: {
            aid1: { id: 'aid1', message: { id: 'aid1', author: { role: 'assistant' }, create_time: ASST_TS } }
          }
        },
        renderedTurns: [{ id: 'e2', turn: turnObj }]
      };
      const unit = fakeEl({
        'data-chatgpt-search-unit-key$': ':assistant',
        'data-chatgpt-search-message-ids': 'aid1'
      });
      const turnEl = fakeEl({});
      turnEl.querySelector = (sel) => sel.includes('":assistant"') ? unit : null;

      const entryFiber = fiber({ entry });
      const holderFiber = fiber({ conversationId: 'c1' }, { state: { memoizedState: snapshot, next: null } });
      const midFiber = fiber({});
      mountChain(turnEl, [entryFiber, holderFiber, midFiber]);

      const r = timeReader.readCreateTime(turnEl, 'assistant');
      return r === ASST_TS ? null : `got ${r}`;
    }
  },
  {
    name: '无任何可靠数据 → null（绝不伪造）',
    fn() {
      const el = fakeEl({});
      const r = timeReader.readCreateTime(el, 'user');
      return r === null ? null : `got ${r}`;
    }
  },
  {
    name: 'readRoleFromFiber: user / assistant 识别',
    fn() {
      const el1 = fakeEl({});
      mountChain(el1, [fiber({ message: { author: { role: 'user' } } })]);
      if (timeReader.readRoleFromFiber(el1) !== 'user') return '应识别为 user';
      const el2 = fakeEl({});
      mountChain(el2, [fiber({ message: { author: { role: 'assistant' } } })]);
      if (timeReader.readRoleFromFiber(el2) !== 'assistant') return '应识别为 assistant';
      return null;
    }
  },
  {
    name: '角色不符（DOM 属性判 user，但数据为 assistant）→ null',
    fn() {
      const el = fakeEl({});
      const msgFiber = fiber({ messages: [{ author: { role: 'assistant' }, create_time: ASST_TS }] });
      mountChain(el, [msgFiber]);
      const r = timeReader.readCreateTime(el, 'user');
      return r === null ? null : `got ${r}（角色不符应返回 null）`;
    }
  }
];
