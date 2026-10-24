/**
 * Sol Watch — 集成验证夹具逻辑
 * 模拟 ChatGPT 页面：mini React Fiber 树 + 语义 DOM + composer/form。
 * 场景按钮执行后把断言写入 #results，最终汇总到 #summary。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const TF = window.SolWatchTimeFormat;
  const MD = window.SolWatchMetadata;
  const Main = window.SolWatchMain;
  const Settings = window.SolWatchSettings;
  const Anchor = window.SolWatchSessionAnchor;

  let passCount = 0;
  let failCount = 0;
  const resultsEl = $('results');
  const traceEl = $('solwatch-trace');
  const dosendEl = $('dosend-log');

  function trace(msg) {
    traceEl.textContent = (traceEl.textContent + '\n' + msg).trim();
  }

  function logPayload(label, payload) {
    dosendEl.textContent = (dosendEl.textContent + `\n[${label}] ${JSON.stringify(payload)}`).trim();
  }

  function ok(name, cond, detail) {
    if (cond) {
      passCount++;
      appendResult(`PASS ${name}`, true);
    } else {
      failCount++;
      appendResult(`FAIL ${name}${detail ? ' :: ' + detail : ''}`, false);
    }
  }

  function appendResult(text, isPass) {
    const div = document.createElement('div');
    div.className = isPass ? 'pass' : 'fail';
    div.textContent = text;
    resultsEl.appendChild(div);
  }

  function summarize() {
    $('summary').textContent = `=== ${passCount} passed, ${failCount} failed ===`;
    trace(`summary: ${passCount} passed, ${failCount} failed`);
  }

  /* ---------- mini fiber helpers（与单测同构） ---------- */

  function fiber(props, opts) {
    const f = {
      tag: (opts && opts.tag) || 0,
      memoizedProps: props || {},
      memoizedState: (opts && opts.state) || null,
      updateQueue: (opts && opts.updateQueue) || null,
      alternate: null,
      return: null,
      child: null,
      sibling: null,
      stateNode: (opts && opts.stateNode) || null
    };
    if (f.child) f.child.return = f;
    return f;
  }

  function mountChain(element, chain) {
    const root = fiber({}, { tag: 3, stateNode: {} });
    root.stateNode.current = root;
    let parent = root;
    for (const node of chain) {
      node.return = parent;
      parent.child = node;
      parent = node;
    }
    element['__reactFiber$fixture'] = parent;
    return root;
  }

  /* ---------- 消息渲染 ---------- */

  function renderUserTurn(opts) {
    const turn = document.createElement('div');
    turn.setAttribute('data-turn-key', opts.turnKey);
    const bubble = document.createElement('div');
    bubble.setAttribute('data-user-message-bubble', '');
    // 若文本首行是 SOL_TIME，拆成独立块（与真实 ChatGPT 多块渲染一致，便于隐藏元数据行）
    const lines = (opts.text || '').split('\n');
    if (MD.isSolTimeLine(lines[0])) {
      const solBlock = document.createElement('div');
      solBlock.textContent = lines[0];
      bubble.appendChild(solBlock);
      const rest = document.createElement('div');
      rest.textContent = lines.slice(1).join('\n').replace(/^\n/, '');
      bubble.appendChild(rest);
    } else {
      const content = document.createElement('div');
      content.textContent = opts.text;
      bubble.appendChild(content);
    }
    turn.appendChild(bubble);

    const unit = document.createElement('div');
    // 注意：选择器 [data-chatgpt-search-unit-key$=":user"] 中 $= 是 CSS 后缀匹配运算符，
    // 真实属性名不含 $，值为 "<前缀>:user" 形式
    unit.setAttribute('data-chatgpt-search-unit-key', opts.turnKey + ':user');
    unit.setAttribute('data-chatgpt-search-message-ids', opts.messageId);
    unit.setAttribute('data-chatgpt-selection-message-id', opts.messageId);
    turn.appendChild(unit);

    $('conversation').appendChild(turn);

    const userItem = { type: 'user-message', messageId: opts.messageId, serverMessageId: opts.messageId };
    const turnObj = { id: opts.turnId, items: [userItem] };
    const entry = { id: opts.turnId, conversationId: opts.conversationId, turn: turnObj };
    const mapping = {};
    if (opts.createTime != null) {
      mapping[opts.messageId] = {
        id: opts.messageId,
        message: { id: opts.messageId, author: { role: 'user' }, create_time: opts.createTime }
      };
    }
    const snapshot = {
      renderedConversation: { current_node: opts.messageId, mapping },
      renderedTurns: [{ id: opts.turnId, turn: turnObj }]
    };
    const entryFiber = fiber({ entry });
    const holderFiber = fiber({ conversationId: opts.conversationId }, { state: { memoizedState: snapshot, next: null } });
    mountChain(turn, [entryFiber, holderFiber, fiber({})]);
    return turn;
  }

  function renderAssistantTurn(opts) {
    const turn = document.createElement('div');
    turn.setAttribute('data-turn-key', opts.turnKey);
    const bubble = document.createElement('div');
    bubble.setAttribute('data-markdown-text-style', 'assistant-message');
    const content = document.createElement('div');
    content.textContent = opts.text;
    bubble.appendChild(content);
    turn.appendChild(bubble);

    const unit = document.createElement('div');
    unit.setAttribute('data-chatgpt-search-unit-key', opts.turnKey + ':assistant');
    unit.setAttribute('data-chatgpt-search-message-ids', opts.messageId);
    unit.setAttribute('data-chatgpt-selection-message-id', opts.messageId);
    turn.appendChild(unit);

    $('conversation').appendChild(turn);

    const asstItem = { type: 'assistant-message', messageId: opts.messageId, latestMessageId: opts.messageId, phase: 'final_answer' };
    const turnObj = { id: opts.turnId, items: [asstItem] };
    const entry = { id: opts.turnId, conversationId: opts.conversationId, turn: turnObj };
    const mapping = {};
    if (opts.createTime != null) {
      mapping[opts.messageId] = {
        id: opts.messageId,
        message: { id: opts.messageId, author: { role: 'assistant' }, create_time: opts.createTime }
      };
    }
    const snapshot = {
      renderedConversation: { current_node: opts.messageId, mapping },
      renderedTurns: [{ id: opts.turnId, turn: turnObj }]
    };
    const entryFiber = fiber({ entry });
    const holderFiber = fiber({ conversationId: opts.conversationId }, { state: { memoizedState: snapshot, next: null } });
    mountChain(turn, [entryFiber, holderFiber, fiber({})]);
    return turn;
  }

  /* ---------- 场景 ---------- */

  async function setMode(mode) {
    await Settings.setSettings({ sendTimeMode: mode });
    Main.applySettings(Settings.getCachedSettings());
  }

  const scenarios = {};

  scenarios.history = function () {
    const convId = 'c1';
    const iOS_TS = Math.round(Date.parse('2026-09-30T21:30:00+08:00') / 1000); // iOS 原生 App 发送
    renderUserTurn({ turnKey: 't-new-1', turnId: 'e1', messageId: 'm1', conversationId: convId, createTime: iOS_TS, text: 'iOS 历史消息' });
    renderUserTurn({ turnKey: 't-new-2', turnId: 'e2', messageId: 'm2', conversationId: convId, createTime: iOS_TS + 3600, text: '网页版消息' });
    renderUserTurn({ turnKey: 't-no-ts', turnId: 'e3', messageId: 'm3', conversationId: convId, createTime: null, text: '无时间消息' });
    // 诊断：打印读取链路
    try {
      const d = [];
      d.push('convId=' + SolWatchDomQueries.getConversationId());
      d.push('candidates=' + SolWatchDomQueries.getMessageCandidates().length);
      const t1 = document.querySelector('[data-turn-key="t-new-1"]');
      const key = t1 && Object.keys(t1).find((k) => k.startsWith('__reactFiber'));
      d.push('fiberKey=' + (key || 'NONE'));
      d.push('readTs=' + SolWatchTimeReader.readCreateTime(t1, 'user'));
      const cf = SolWatchFiberAdapter.getCommittedFiber(t1);
      d.push('committedFiber=' + (cf ? 'ok' : 'null'));
      const conv2 = SolWatchDomQueries.getConversationId();
      if (cf) {
        const te = SolWatchFiberAdapter.getTurnEntry(cf, conv2);
        d.push('turnEntry=' + (te ? ('items=' + te.items.length) : 'null'));
        if (te) {
          const live = SolWatchFiberAdapter.findLiveSnapshot(cf, te);
          d.push('live=' + (live ? ('mapping=' + Object.keys(live.mapping).join(',')) : 'null'));
          if (live) {
            const m = live.mapping['mid1'];
            d.push('mid1=' + (m ? ('id=' + m.id + ' role=' + (m.message && m.message.author && m.message.author.role) + ' ct=' + (m.message && m.message.create_time)) : 'MISSING'));
          }
        }
      }
      // 直接解析用户 item 链
      if (cf) {
        const te = SolWatchFiberAdapter.getTurnEntry(cf, conv2);
        const userItem = te && te.items.find((i) => i.type === 'user-message');
        d.push('userItem=' + (userItem ? JSON.stringify({ mid: userItem.messageId, smid: userItem.serverMessageId }) : 'null'));
        const unit = t1.querySelector('[data-chatgpt-search-unit-key$=":user"]');
        d.push('unitIds=' + (unit ? (unit.getAttribute('data-chatgpt-search-message-ids') || 'NONE') : 'NO-UNIT'));
      }
      trace('DIAG ' + d.join(' | '));
    } catch (e) { trace('DIAG err ' + e.message); }
    Main.scan();

    const labels = document.querySelectorAll('.solwatch-time-label');
    ok('history: 有可靠时间的消息才显示标签', labels.length === 2, `labels=${labels.length}`);

    const firstLabel = document.querySelector('#conversation [data-turn-key="t-new-1"] .solwatch-time-label');
    const expected = TF.formatClockTime(iOS_TS, true);
    ok('history: iOS 历史消息显示真实本地时间', firstLabel && firstLabel.textContent === expected, firstLabel ? firstLabel.textContent : 'none');

    const noTsLabel = document.querySelector('#conversation [data-turn-key="t-no-ts"] .solwatch-time-label');
    ok('history: 无 create_time 不伪造时间', !noTsLabel);

    const secondLabel = document.querySelector('#conversation [data-turn-key="t-new-2"] .solwatch-time-label');
    ok('history: 第二条消息标签存在', !!secondLabel);
  };

  scenarios.send = async function (via = 'click') {
    await setMode('always');
    const ta = $('composer');
    const original = '第一行\n第二行  **Markdown**  😀 中文 English';
    ta.value = original;
    window.__solWatchLastPayload = undefined;
    if (via === 'enter') {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    } else {
      $('send-btn').click();
    }
    return new Promise((resolve) => setTimeout(() => {
      const payload = getLastPayload();
      if (!payload) {
        ok(`send(${via}): 应产生 payload`, false, '无 payload');
        resolve();
        return;
      }
      ok(`send(${via}): payload 首行是紧凑时间元数据`, MD.countSolTimeLines(payload) === 1, payload.slice(0, 60));
      ok(`send(${via}): 用户正文逐字保留`, payload.indexOf(original) >= 0);
      const turns = document.querySelectorAll('#conversation [data-user-message-bubble]');
      const lastLabel = turns.length && turns[turns.length - 1].querySelector('.solwatch-time-label');
      ok(`send(${via}): 新消息带有时间标签`, !!lastLabel, lastLabel ? lastLabel.textContent : 'none');
      resolve();
    }, 350));
  };

  scenarios.enter = function () {
    return scenarios.send('enter');
  };

  scenarios.shiftEnter = function () {
    const ta = $('composer');
    ta.value = '只换行\n';
    window.__solWatchLastPayload = undefined;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    return new Promise((resolve) => setTimeout(() => {
      ok('shift+enter: 不注入、不发送', ta.value === '只换行\n' && getLastPayload() == null, 'value=' + JSON.stringify(ta.value));
      resolve();
    }, 350));
  };

  scenarios.debugLine = async function () {
    await setMode('always');
    const ta = $('composer');
    ta.value = '调试行测试';
    $('send-btn').click();
    await wait(400);
    // 找到最后一条用户消息气泡
    const turns = document.querySelectorAll('#conversation [data-user-message-bubble]');
    const lastBubble = turns[turns.length - 1];
    const block = lastBubble && lastBubble.querySelector('[data-solwatch-hidden]');
    ok('debug 默认关: 时间元数据行已隐藏', !!block, 'hidden 标记未找到');

    Main.applySettings({ showSolTimeDebugLine: true });
    Main.scan();
    const visibleBlocks = document.querySelectorAll('#conversation [data-user-message-bubble] [data-solwatch-hidden]');
    ok('debug 开: 时间元数据行恢复可见', visibleBlocks.length === 0, `仍隐藏 ${visibleBlocks.length} 处`);

    Main.applySettings({ showSolTimeDebugLine: false });
    Main.scan();
  };

  scenarios.sendModeOff = async function () {
    // 兼容旧设置：只写 tellModelSendTime=false，应迁移到 sendTimeMode=off
    await Settings.setSettings({ tellModelSendTime: false });
    Main.applySettings(Settings.getCachedSettings());
    ok('settings: 旧字段 false 迁移为 off', Settings.getCachedSettings().sendTimeMode === 'off', Settings.getCachedSettings().sendTimeMode);
    const ta = $('composer');
    const original = '关闭注入后原样发送';
    ta.value = original;
    window.__solWatchLastPayload = undefined;
    $('send-btn').click();
    await wait(400);
    const payload = getLastPayload();
    ok('off: 消息未被修改（原样发送，无时间元数据）', payload === original, 'payload=' + JSON.stringify(payload));
    ok('off: payload 无元数据行', payload == null || MD.countSolTimeLines(payload) === 0, String(payload).slice(0, 60));
  };

  scenarios.session = async function () {
    await setMode('session');
    Anchor.reset();
    const ta = $('composer');

    ta.value = '会话锚点第一条';
    window.__solWatchLastPayload = undefined;
    $('send-btn').click();
    await wait(400);
    const first = getLastPayload();
    ok('session: 首条注入', !!first && MD.countSolTimeLines(first) === 1, String(first).slice(0, 60));

    // 30 分钟内：应完全放行原生发送，payload 保持原文
    ta.value = '会话锚点第二条';
    window.__solWatchLastPayload = undefined;
    $('send-btn').click();
    await wait(400);
    const second = getLastPayload();
    ok('session: 30 分钟内不注入', second === '会话锚点第二条', 'payload=' + JSON.stringify(second));

    // 编辑/重发已有旧格式：必须替换为本次紧凑格式
    const oldLine = '[SOL_TIME v=1 sent_at="2020-01-01T00:00:00+08:00" timezone="Asia/Shanghai"]';
    ta.value = oldLine + '\n编辑重发正文';
    window.__solWatchLastPayload = undefined;
    $('send-btn').click();
    await wait(400);
    const retried = getLastPayload();
    const firstLine = retried ? retried.split(/\r?\n/)[0] : '';
    ok('session: 编辑重发替换旧元数据', !!retried && MD.isCompactSolTimeLine(firstLine) && MD.countSolTimeLines(retried) === 1, String(retried).slice(0, 80));
    ok('session: 编辑重发正文保留', !!retried && retried.endsWith('编辑重发正文'), String(retried).slice(-40));
    await setMode('always');
  };

  scenarios.modeAlways = async function () {
    await setMode('always');
    Anchor.reset();
    const ta = $('composer');
    ta.value = 'always 第一条';
    window.__solWatchLastPayload = undefined;
    $('send-btn').click();
    await wait(400);
    const first = getLastPayload();
    ok('always: 第一条注入', !!first && MD.countSolTimeLines(first) === 1, String(first).slice(0, 60));

    ta.value = 'always 第二条';
    window.__solWatchLastPayload = undefined;
    $('send-btn').click();
    await wait(400);
    const second = getLastPayload();
    ok('always: 第二条仍注入', !!second && MD.countSolTimeLines(second) === 1, String(second).slice(0, 60));
  };

  scenarios.assistant = async function () {
    const ASST_TS = Math.round(Date.parse('2026-10-01T01:00:00+08:00') / 1000);
    renderAssistantTurn({ turnKey: 't-a1', turnId: 'ea1', messageId: 'ma1', conversationId: 'c1', createTime: ASST_TS, text: 'assistant 回复 1' });
    renderAssistantTurn({ turnKey: 't-a2', turnId: 'ea2', messageId: 'ma2', conversationId: 'c1', createTime: ASST_TS + 600, text: 'assistant 回复 2' });
    Main.applySettings({ showAssistantTime: true });
    Main.scan();
    const labels = document.querySelectorAll('[data-markdown-text-style="assistant-message"] .solwatch-time-label');
    ok('assistant 开: 两条回复均有标签', labels.length === 2, `labels=${labels.length}`);

    Main.applySettings({ showAssistantTime: false });
    Main.scan();
    const labelsOff = document.querySelectorAll('[data-markdown-text-style="assistant-message"] .solwatch-time-label');
    ok('assistant 关: 标签全部移除', labelsOff.length === 0, `labels=${labelsOff.length}`);
  };

  scenarios.format = async function () {
    const iOS_TS = Math.round(Date.parse('2026-09-30T21:30:00+08:00') / 1000);
    Main.applySettings({ use24HourFormat: false });
    Main.scan();
    const label12 = document.querySelector('#conversation [data-turn-key="t-new-1"] .solwatch-time-label');
    ok('12h 制: 标签含 AM/PM', !!label12 && /AM|PM/.test(label12.textContent), label12 ? label12.textContent : 'none');

    Main.applySettings({ use24HourFormat: true });
    Main.scan();
    const label24 = document.querySelector('#conversation [data-turn-key="t-new-1"] .solwatch-time-label');
    ok('24h 制: 标签为 HH:mm:ss 格式', !!label24 && /^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(label24.textContent), label24 ? label24.textContent : 'none');
    ok('24h 制: 数值与本地时区一致', label24.textContent === TF.formatClockTime(iOS_TS, true), label24 ? label24.textContent : 'none');
  };

  scenarios.copy = function () {
    const line = MD.buildSolTimeLine(new Date('2026-10-21T10:36:18+08:00'));
    function copyText(text) {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
      return dt.getData('text/plain');
    }

    // 绝对开头：元数据被剥离，正文保留
    const result = copyText(line + '\n正文第一行\n正文第二行');
    ok('copy: 开头元数据被剥离', !MD.matchSolTimePrefix(result), JSON.stringify(result));
    ok('copy: 正文内容保留', result === '正文第一行\n正文第二行', JSON.stringify(result));

    // 正文后部的示例：不得因为复制被删掉
    const exampleText = '正文第一行\n' + line + '\n正文第二行';
    const exampleResult = copyText(exampleText);
    ok('copy: 正文中的元数据示例不被剥离', exampleResult === exampleText, JSON.stringify(exampleResult));
  };

  scenarios.retry = async function () {
    await setMode('always');
    const ta = $('composer');
    // 旧版格式 + 旧版双换行：编辑重发后应升级为紧凑格式 + 单换行
    const oldLine = '[SOL_TIME v=1 sent_at="2020-01-01T00:00:00+08:00" timezone="Asia/Shanghai"]';
    const body = '编辑后的正文\n第二行';
    ta.value = oldLine + '\n\n' + body;
    $('send-btn').click();
    await wait(400);
    const payload = getLastPayload();
    if (!payload) {
      ok('retry: 应产生 payload', false, '无 payload');
      return;
    }
    const lines = payload.split(/\n/);
    ok('retry: 仅一行元数据（替换而非追加）', MD.countSolTimeLines(payload) === 1, JSON.stringify(payload.slice(0, 80)));
    ok('retry: 旧格式升级为紧凑格式', MD.isCompactSolTimeLine(lines[0]), lines[0]);
    ok('retry: 新时间为实际发送时间（非旧行）', lines[0] !== oldLine, lines[0]);
    ok('retry: 元数据与正文之间只有单换行', lines[1] !== '', JSON.stringify(payload.slice(0, 100)));
    ok('retry: 编辑正文逐字保留', payload.endsWith(body), JSON.stringify(payload));
  };

  scenarios.streaming = async function () {
    // 模拟流式追加：新增 assistant 消息（observer 节流后应自动加标签）
    const ASST_TS = Math.round(Date.parse('2026-10-01T02:00:00+08:00') / 1000);
    renderAssistantTurn({ turnKey: 't-stream', turnId: 'est', messageId: 'mst', conversationId: 'c1', createTime: ASST_TS, text: '流式生成的回复' });
    Main.applySettings({ showAssistantTime: true });
    await wait(700); // 等 observer 节流扫描
    const label = document.querySelector('#conversation [data-turn-key="t-stream"] .solwatch-time-label');
    ok('streaming: 新消息自动出现时间标签', !!label && label.textContent === TF.formatClockTime(ASST_TS, true), label ? label.textContent : 'none');
    Main.applySettings({ showAssistantTime: false });
  };

  scenarios.spa = async function () {
    // 切换会话：更新会话 id + hash 变化 → 重扫
    $('conv-id-holder').setAttribute('data-conversation-id', 'c2');
    renderUserTurn({ turnKey: 't-spa', turnId: 'esp', messageId: 'msp', conversationId: 'c2', createTime: Math.round(Date.parse('2026-10-02T08:00:00+08:00') / 1000), text: '新会话消息' });
    try { window.location.hash = 'c2'; } catch (_e) { /* file:// 忽略 */ }
    await wait(700);
    const label = document.querySelector('#conversation [data-turn-key="t-spa"] .solwatch-time-label');
    ok('spa: 切换会话后重扫并显示时间', !!label, label ? label.textContent : 'none');
  };

  scenarios.regenerate = async function () {
    // 重新生成：替换 assistant fiber 的 create_time → 标签应更新
    $('conv-id-holder').setAttribute('data-conversation-id', 'c1'); // 回到 c1 会话
    const ASST_TS_OLD = Math.round(Date.parse('2026-10-01T03:00:00+08:00') / 1000);
    const ASST_TS_NEW = ASST_TS_OLD + 300;
    const turn = renderAssistantTurn({ turnKey: 't-regen', turnId: 'erg', messageId: 'mrg', conversationId: 'c1', createTime: ASST_TS_OLD, text: '重新生成的回复' });
    Main.applySettings({ showAssistantTime: true });
    Main.scan();
    const before = document.querySelector('#conversation [data-turn-key="t-regen"] .solwatch-time-label');
    ok('regen: 初始标签存在', !!before);

    // 替换 fiber 数据（模拟 regenerate 更新）
    const key = Object.keys(turn).find((k) => k.startsWith('__reactFiber$'));
    const leaf = turn[key];
    const holder = leaf.return;
    const snapshot = holder.memoizedState.memoizedState;
    snapshot.renderedConversation.mapping.mrg.message.create_time = ASST_TS_NEW;
    Main.scan();
    const after = document.querySelector('#conversation [data-turn-key="t-regen"] .solwatch-time-label');
    ok('regen: 重新生成后标签更新', !!after && after.textContent === TF.formatClockTime(ASST_TS_NEW, true), after ? after.textContent : 'none');
    Main.applySettings({ showAssistantTime: false });
  };

  scenarios.empty = async function () {
    const ta = $('composer');
    ta.value = '';
    window.__solWatchLastPayload = undefined;
    $('send-btn').click();
    await wait(300);
    ok('empty: 空消息不注入不发送', getLastPayload() == null, String(getLastPayload()));
  };

  /* ---------- payload 记录（模拟 ChatGPT 提交） ---------- */

  function getLastPayload() {
    return window.__solWatchLastPayload;
  }

  function recordPayload(e) {
    e.preventDefault();
    const ta = $('composer');
    if (!ta.value) {
      // 空消息：ChatGPT 不会提交
      window.__solWatchLastPayload = undefined;
      return;
    }
    window.__solWatchLastPayload = ta.value;
    logPayload(new Date().toISOString().slice(11, 19), ta.value);
    // 渲染发送后的新消息（带 create_time = 当前时间，模拟服务端返回）
    const now = Math.round(Date.now() / 1000);
    const count = document.querySelectorAll('#conversation [data-user-message-bubble]').length;
    renderUserTurn({
      turnKey: 't-sent-' + count,
      turnId: 'es' + count,
      messageId: 'ms' + count,
      conversationId: 'c1',
      createTime: now,
      text: ta.value
    });
    ta.value = '';
    // 触发一次扫描让新消息带标签
    Main.scan();
  }

  /* ---------- 工具 ---------- */

  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* ---------- 场景执行器 ---------- */

  async function runScenario(name) {
    trace('run: ' + name);
    const fn = scenarios[name];
    if (!fn) { trace('unknown scenario: ' + name); return; }
    await fn();
    summarize();
  }

  function bind(name, btnId) {
    $(btnId).addEventListener('click', () => runScenario(name));
  }

  function init() {
    bind('history', 'btn-history');
    bind('send', 'btn-send');
    bind('enter', 'btn-enter');
    bind('shiftEnter', 'btn-shift-enter');
    bind('debugLine', 'btn-debug');
    bind('session', 'btn-session');
    bind('modeAlways', 'btn-mode-always');
    bind('sendModeOff', 'btn-mode-off');
    bind('assistant', 'btn-assistant');
    bind('format', 'btn-format');
    bind('copy', 'btn-copy');
    bind('retry', 'btn-retry');
    bind('streaming', 'btn-stream');
    bind('spa', 'btn-spa');
    bind('regenerate', 'btn-regen');
    bind('empty', 'btn-empty');

    $('btn-reset-fixture').addEventListener('click', () => {
      $('conversation').innerHTML = '';
      resultsEl.innerHTML = '';
      dosendEl.textContent = '';
      traceEl.textContent = '';
      passCount = 0;
      failCount = 0;
      window.__solWatchLastPayload = undefined;
      Anchor.reset();
      Settings.resetSettings().then(() => Main.applySettings(Settings.DEFAULTS));
      summarize();
    });

    // form submit：模拟 ChatGPT 实际提交（recordPayload）
    $('composer-form').addEventListener('submit', recordPayload);

    // 暴露场景供外部（bu / 手动）驱动
    window.runScenario = runScenario;
    window.solWatchFixture = { passCount: () => passCount, failCount: () => failCount, getLastPayload };

    trace('fixture ready; SolWatch senderHook installed=' + !!(window.__solWatchSenderHookInstalled));
  }

  // main.js 自动 init 由 chrome-stub 触发；显式再调用一次保证幂等可用
  try { Main.init(); } catch (e) { trace('Main.init error: ' + e.message); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
