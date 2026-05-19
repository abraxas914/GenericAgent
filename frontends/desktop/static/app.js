// GenericAgent 桌面版 —— 真实客户端逻辑（bridge 数据层 + i18n）。
// 数据走 HTTP（window.ga / ga-web.js），WS 仅状态通知。
// 文案全部走 i18n：静态用 data-i18n / data-i18n-ph / data-i18n-title，
// 动态用 t(key)。dev 标注层与发给 agent 的预设 prompt 不进 UI 字典。
'use strict';

/* ═══════════════ i18n ═══════════════ */
const I18N = {
  zh: {
    'app.title': 'GenericAgent 桌面版',
    'brand.sub': '桌面终端',
    'nav.chat': '聊天', 'nav.channels': '消息通道', 'nav.status': '状态面板',
    'nav.collab': '协作动态', 'nav.token': 'Token 统计',
    'foot.settings': '配置', 'foot.ver': 'GenericAgent · 桌面版',
    'chat.startTitle': '开始对话', 'chat.startSub': '直接输入，或点预设功能一键启动',
    'preset.goal.t': 'Goal 模式', 'preset.goal.d': '设定目标，自主完成',
    'preset.explore.t': '自主探索', 'preset.explore.d': '自动浏览并周期汇总',
    'preset.hive.t': 'Hive 协作', 'preset.hive.d': '多 worker 协同攻坚',
    'preset.review.t': '深度复核', 'preset.review.d': '挑刺式质量把关',
    'preset.mine.t': '我的·周报', 'preset.mine.d': '自定义：抓本周提交并写周报',
    'preset.add.t': '自定义', 'preset.add.d': '任意一句话存为功能',
    'composer.placeholder': '输入消息… (Enter 发送, Shift+Enter 换行)',
    'search.placeholder': '搜索会话…', 'conv.new': '新对话',
    'ctx.pin': '置顶', 'ctx.del': '删除',
    'common.close': '关闭', 'common.more': '更多',
    'modal.preset': '预设功能', 'modal.addModel': '添加模型', 'modal.settings': '配置',
    'set.theme': '主题色', 'set.lang': '语言', 'set.model': '模型', 'set.addModel': '添加模型',
    'page.channels.title': '消息通道', 'page.channels.sub': '把 hub.pyw 管理的各 imbot 接入搬进来：每行一个渠道',
    'page.status.title': '状态面板', 'page.status.sub': 'hub.pyw 管理的后台进程/服务，集中查看与启停',
    'page.collab.title': '协作动态', 'page.collab.sub': 'subagent / Hive worker 的实时状态与产出',
    'page.token.title': 'Token 统计', 'page.token.sub': '每会话与累计的 token 用量及估算成本',
    'status.connecting': '连接中…', 'status.ready': '就绪', 'status.running': '运行中',
    'status.disconnected': '未连接', 'status.stopped': '已停止', 'status.idle': '空闲',
    'conv.emptyList': '暂无会话，点「＋ 新对话」开始', 'conv.defaultTitle': '新对话',
    'err.bridge': 'bridge 未连接', 'err.newSession': '新建会话失败', 'err.poll': '轮询失败', 'err.stop': '停止失败',
    'sys.stopRequested': '已请求停止',
    'slash.help': '可用命令：\n/new 新会话  /clear 清屏  /stop 停止  /settings 设置',
    'slash.unknown': '未知命令',
    'upload.hint': '图片上传：粘贴图片到输入框即可（多模态接入中）',
    'fold.thinking': '思考', 'fold.tool': '工具调用', 'fold.toolResult': '工具结果', 'fold.llm': 'LLM Running',
    'model.auto': '自动选择',
    'ch.wechat': '微信', 'ch.wecom': '企业微信', 'ch.lark': '飞书', 'ch.dingtalk': '钉钉',
    'st.online': '在线', 'st.offline': '离线', 'st.error': '错误', 'st.running': '运行', 'st.abnormal': '异常',
    'act.configure': '配置', 'act.logs': '日志', 'act.restart': '重启', 'act.stop': '停止', 'act.start': '启动',
    'proc.imbotWechat': 'imbot · 微信', 'proc.imbotDing': 'imbot · 钉钉', 'proc.scheduler': '定时任务调度',
    'cm.scheduling': '调度中', 'cm.running': '执行中', 'cm.idleSt': '空闲',
    'cm.master': '已派 3 子任务', 'cm.w1': '子任务：抓取数据', 'cm.w2': '子任务：复核结果', 'cm.sub': '等待派单',
    'tok.total': '累计 token', 'tok.cost': '估算成本', 'tok.today': '今日 token',
    'tok.colSession': '会话', 'tok.colModel': '模型', 'tok.colIn': '输入', 'tok.colOut': '输出', 'tok.colCost': '成本',
    'tok.s1': '选股分析', 'tok.s2': '批量整理', 'tok.s3': 'Goal·部署',
    'presetPrompt.goal': '进入 Goal 模式：读 L3 goal mode SOP，自主达成我接下来描述的目标。',
    'presetPrompt.explore': '进入自主探索模式：自动浏览并定期向我汇总要点。',
    'presetPrompt.hive': '启动 Goal Hive 模式：按 hive SOP 拉起多个 worker 协同完成我接下来的目标。',
    'presetPrompt.review': '进入监察者模式：对刚才的产出严格挑刺、逐项复核并报告问题。',
    'presetPrompt.mine': '抓取本周的 git 提交并写一份周报。',
  },
  en: {
    'app.title': 'GenericAgent Desktop',
    'brand.sub': 'Desktop terminal',
    'nav.chat': 'Chat', 'nav.channels': 'Channels', 'nav.status': 'Status',
    'nav.collab': 'Collaboration', 'nav.token': 'Token usage',
    'foot.settings': 'Settings', 'foot.ver': 'GenericAgent · Desktop',
    'chat.startTitle': 'Start a conversation', 'chat.startSub': 'Type a message, or pick a preset',
    'preset.goal.t': 'Goal mode', 'preset.goal.d': 'Set a goal, run autonomously',
    'preset.explore.t': 'Auto explore', 'preset.explore.d': 'Browse & summarize periodically',
    'preset.hive.t': 'Hive', 'preset.hive.d': 'Multi-worker collaboration',
    'preset.review.t': 'Deep review', 'preset.review.d': 'Strict quality check',
    'preset.mine.t': 'My · Weekly', 'preset.mine.d': 'Custom: weekly report from commits',
    'preset.add.t': 'Custom', 'preset.add.d': 'Save any prompt as a function',
    'composer.placeholder': 'Type a message… (Enter to send, Shift+Enter for newline)',
    'search.placeholder': 'Search chats…', 'conv.new': 'New chat',
    'ctx.pin': 'Pin', 'ctx.del': 'Delete',
    'common.close': 'Close', 'common.more': 'More',
    'modal.preset': 'Presets', 'modal.addModel': 'Add model', 'modal.settings': 'Settings',
    'set.theme': 'Theme color', 'set.lang': 'Language', 'set.model': 'Model', 'set.addModel': 'Add model',
    'page.channels.title': 'Channels', 'page.channels.sub': 'imbot channels managed by hub.pyw — one row per channel',
    'page.status.title': 'Status', 'page.status.sub': 'Background processes/services managed by hub.pyw',
    'page.collab.title': 'Collaboration', 'page.collab.sub': 'Live state & output of subagents / Hive workers',
    'page.token.title': 'Token usage', 'page.token.sub': 'Per-session and total token usage & estimated cost',
    'status.connecting': 'Connecting…', 'status.ready': 'Ready', 'status.running': 'Running',
    'status.disconnected': 'Disconnected', 'status.stopped': 'Stopped', 'status.idle': 'Idle',
    'conv.emptyList': 'No chats yet — click “＋ New chat”', 'conv.defaultTitle': 'New chat',
    'err.bridge': 'Bridge not connected', 'err.newSession': 'Failed to create session', 'err.poll': 'Polling failed', 'err.stop': 'Stop failed',
    'sys.stopRequested': 'Stop requested',
    'slash.help': 'Commands:\n/new new chat  /clear clear  /stop stop  /settings settings',
    'slash.unknown': 'Unknown command',
    'upload.hint': 'Image upload: paste an image into the input box (multimodal WIP)',
    'fold.thinking': 'Thinking', 'fold.tool': 'Tool call', 'fold.toolResult': 'Tool result', 'fold.llm': 'LLM Running',
    'model.auto': 'Auto',
    'ch.wechat': 'WeChat', 'ch.wecom': 'WeCom', 'ch.lark': 'Lark', 'ch.dingtalk': 'DingTalk',
    'st.online': 'Online', 'st.offline': 'Offline', 'st.error': 'Error', 'st.running': 'Running', 'st.abnormal': 'Error',
    'act.configure': 'Configure', 'act.logs': 'Logs', 'act.restart': 'Restart', 'act.stop': 'Stop', 'act.start': 'Start',
    'proc.imbotWechat': 'imbot · WeChat', 'proc.imbotDing': 'imbot · DingTalk', 'proc.scheduler': 'Scheduler',
    'cm.scheduling': 'Scheduling', 'cm.running': 'Running', 'cm.idleSt': 'Idle',
    'cm.master': 'Dispatched 3 subtasks', 'cm.w1': 'Subtask: fetch data', 'cm.w2': 'Subtask: review results', 'cm.sub': 'Waiting for tasks',
    'tok.total': 'Total tokens', 'tok.cost': 'Est. cost', 'tok.today': 'Today tokens',
    'tok.colSession': 'Session', 'tok.colModel': 'Model', 'tok.colIn': 'Input', 'tok.colOut': 'Output', 'tok.colCost': 'Cost',
    'tok.s1': 'Stock screening', 'tok.s2': 'Batch tidy-up', 'tok.s3': 'Goal · Deploy',
    'presetPrompt.goal': 'Enter Goal mode: read the L3 goal-mode SOP and autonomously achieve the goal I describe next.',
    'presetPrompt.explore': 'Enter auto-explore mode: browse autonomously and periodically summarize key points to me.',
    'presetPrompt.hive': 'Start Goal Hive mode: per the hive SOP, spawn multiple workers to collaboratively achieve the goal I describe next.',
    'presetPrompt.review': 'Enter reviewer mode: strictly scrutinize the previous output, review item by item and report issues.',
    'presetPrompt.mine': 'Collect this week\'s git commits and write a weekly report.',
  },
};
let lang = (localStorage.getItem('ga_lang') === 'en') ? 'en' : 'zh';
function t(key) { return (I18N[lang] && I18N[lang][key]) || (I18N.zh[key]) || key; }
function applyI18n() {
  document.documentElement.lang = (lang === 'en') ? 'en' : 'zh-CN';
  document.title = t('app.title');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', t(el.dataset.i18nPh)); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', t(el.dataset.i18nTitle)); });
}

/* ═══════════════ 侧边栏导航 ═══════════════ */
const nav = document.getElementById('nav');
const pages = document.querySelectorAll('#pages .page');
nav.addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  const key = item.dataset.page;
  nav.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n === item));
  pages.forEach(p => p.classList.toggle('active', p.dataset.page === key));
});

/* ═══════════════ 弹窗开关 ═══════════════ */
const openModal = (id) => { const m = document.getElementById(id); if (m) m.hidden = false; };
const closeModals = () => document.querySelectorAll('.modal').forEach(m => m.hidden = true);
const bindClick = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
bindClick('add-model-btn', (e) => { e.stopPropagation(); openModal('add-model-modal'); });
bindClick('settings-btn',  (e) => { e.stopPropagation(); openModal('settings-modal'); });
bindClick('preset-btn',    (e) => { e.stopPropagation(); openModal('preset-modal'); });
document.querySelectorAll('.modal').forEach(m =>
  m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) m.hidden = true; }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

/* ═══════════════ Markdown ═══════════════ */
if (typeof marked !== 'undefined') {
  marked.setOptions({ gfm: true, breaks: true, mangle: false, headerIds: false });
}
const ALLOWED_URI_RE = /^(https?:|mailto:|tel:|#|\/)/i;
function escapeHtml(s) {
  const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML;
}
function sanitizeMarkdown(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  const blocked = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','LINK','META','BASE','FORM','INPUT','BUTTON']);
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT);
  const rmv = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (blocked.has(el.tagName)) { rmv.push(el); continue; }
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase(), v = attr.value.trim();
      if (n.startsWith('on') || n === 'srcdoc') { el.removeAttribute(attr.name); continue; }
      if ((n === 'href' || n === 'src' || n === 'xlink:href') && v && !ALLOWED_URI_RE.test(v)) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') { el.setAttribute('rel','noopener noreferrer'); el.setAttribute('target','_blank'); }
  }
  rmv.forEach(el => el.remove());
  return tpl.innerHTML;
}
function renderMarkdown(text) {
  if (typeof marked === 'undefined') return escapeHtml(text).replace(/\n/g, '<br>');
  try { return sanitizeMarkdown(marked.parse(String(text || ''))); }
  catch (_) { return escapeHtml(text); }
}
function renderAssistant(text) {
  let s = String(text || '');
  const folds = [];
  const stash = (label, body) => { folds.push({ label, body }); return ` F${folds.length - 1} `; };
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, m => stash(t('fold.thinking'), m.replace(/<\/?thinking>/gi, '')));
  s = s.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, m => stash(t('fold.tool'), m));
  s = s.replace(/<function_results>[\s\S]*?<\/function_results>/gi, m => stash(t('fold.toolResult'), m));
  s = s.replace(/(\**LLM Running \(Turn \d+\) \.\.\.\**)/g, m => stash(t('fold.llm'), m));
  let html = renderMarkdown(s);
  html = html.replace(/F(\d+)/g, (_, i) => {
    const f = folds[Number(i)];
    return `<details class="fold"><summary>${escapeHtml(f.label)}</summary><pre>${escapeHtml(f.body)}</pre></details>`;
  });
  return html;
}

/* ═══════════════ 状态 ═══════════════ */
const state = {
  sessions: new Map(), activeId: null, bridgeReady: false,
  llmNo: 0, modelProfiles: [], modelName: null,
  runtime: new Map(),
};
function rt(sess) {
  let r = state.runtime.get(sess.id);
  if (!r) { r = { polling:false, busy:false, lastId:0, seen:new Set(), draftEl:null, draftText:'' }; state.runtime.set(sess.id, r); }
  return r;
}
const activeSess = () => state.sessions.get(state.activeId) || null;
const isActive = (sess) => sess && sess.id === state.activeId;

/* ═══════════════ DOM refs ═══════════════ */
const chatPage   = document.querySelector('.page[data-page="chat"]');
const msgArea    = chatPage.querySelector('.msg-area');
const chatStart  = msgArea.querySelector('.chat-start');
const inputEl    = chatPage.querySelector('.input');
const sendBtn    = chatPage.querySelector('.send');
const runToggle  = document.getElementById('run-toggle');
const runLabel   = runToggle.querySelector('.rs-label');
const convListEl = document.querySelector('.conv-list');
const newConvBtn = document.querySelector('.new-conv');
const searchInput = document.querySelector('.search input');
const rpToggle   = document.getElementById('rp-toggle');
const rpResize   = document.getElementById('rp-resize');
const rpPanel    = document.getElementById('rightpanel');
const bodyEl     = document.querySelector('.body');
if (rpToggle) rpToggle.addEventListener('click', () => bodyEl.classList.toggle('rp-collapsed'));

if (rpResize && rpPanel) {
  let dragging = false, startX = 0, startW = 0;
  rpResize.addEventListener('mousedown', (e) => {
    dragging = true; startX = e.clientX; startW = rpPanel.offsetWidth;
    rpResize.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.min(400, Math.max(160, startW + (startX - e.clientX)));
    rpPanel.style.width = w + 'px';
    rpPanel.style.flex = '0 0 ' + w + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    rpResize.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}
const modelChip  = document.getElementById('model-chip');
const modelNameEl= modelChip ? modelChip.querySelector('.model-name') : null;
const langSel    = document.getElementById('lang-select');

let msgsEl = null;
function ensureMsgs() {
  if (!msgsEl) { msgsEl = document.createElement('div'); msgsEl.className = 'msgs'; msgArea.appendChild(msgsEl); }
  return msgsEl;
}
function refreshEmptyState(sess) {
  const has = sess && sess.messages.length > 0;
  msgArea.classList.toggle('has-msgs', !!has);
  if (chatStart) chatStart.style.display = has ? 'none' : '';
  if (msgsEl) msgsEl.style.display = has ? '' : 'none';
}

/* ═══════════════ 消息渲染 ═══════════════ */
function msgNode(msg) {
  const el = document.createElement('div');
  el.className = 'msg ' + (msg.role || 'system');
  if (msg.role === 'user') el.innerHTML = `<div class="bubble">${escapeHtml(msg.content)}</div>`;
  else if (msg.role === 'assistant') el.innerHTML = `<div class="bubble md">${renderAssistant(msg.content)}</div>`;
  else if (msg.role === 'error') el.innerHTML = `<div class="bubble err">${escapeHtml(msg.content)}</div>`;
  else el.innerHTML = `<div class="bubble sys">${escapeHtml(msg.content)}</div>`;
  return el;
}
function renderAllMessages(sess) {
  const box = ensureMsgs(); box.innerHTML = '';
  for (const m of sess.messages) box.appendChild(msgNode(m));
  refreshEmptyState(sess); scrollBottom();
}
function appendMessage(sess, msg) {
  if (!isActive(sess)) return;
  ensureMsgs().appendChild(msgNode(msg));
  refreshEmptyState(sess); scrollBottom();
}
function scrollBottom() { requestAnimationFrame(() => { msgArea.scrollTop = msgArea.scrollHeight; }); }
function renderDraft(sess) {
  const r = rt(sess);
  if (!isActive(sess)) return;
  const box = ensureMsgs();
  if (!r.draftEl || r.draftEl.parentNode !== box) {
    r.draftEl = document.createElement('div'); r.draftEl.className = 'msg assistant'; box.appendChild(r.draftEl);
  }
  r.draftEl.innerHTML = `<div class="bubble md">${renderAssistant(r.draftText)}<span class="cursor"></span></div>`;
  refreshEmptyState(sess); scrollBottom();
}

/* ═══════════════ 运行状态 ═══════════════ */
function statusLabel() {
  const s = activeSess();
  if (s && rt(s).busy) return t('status.running');
  return state.bridgeReady ? t('status.ready') : t('status.disconnected');
}
function refreshStatusLabel() { if (!runToggle.classList.contains('stopped')) runLabel.textContent = statusLabel(); }
function setBusy(sess, busy) {
  const r = rt(sess); r.busy = busy;
  if (!isActive(sess)) return;
  runToggle.classList.remove('stopped');
  runToggle.classList.toggle('busy', busy);
  runLabel.textContent = busy ? t('status.running') : (state.bridgeReady ? t('status.ready') : t('status.disconnected'));
  sendBtn.disabled = busy;
}
runToggle.addEventListener('click', async () => {
  const sess = activeSess();
  if (sess && rt(sess).busy) {
    await cancelPrompt();
    runLabel.textContent = t('status.stopped');
    runToggle.classList.add('stopped');
  }
});

/* ═══════════════ 会话 ═══════════════ */
function isUntitled(x) { return !x || /^(new chat|新对话|新会话)$/i.test(String(x).trim()); }
function renderSessionList() {
  convListEl.innerHTML = '';
  const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
  const all = [...state.sessions.values()];
  const filtered = query
    ? all.filter(s => {
        const title = (s.title || '').toLowerCase();
        const hasMsg = s.messages && s.messages.some(m => (m.text || '').toLowerCase().includes(query));
        return title.includes(query) || hasMsg;
      })
    : all;
  if (filtered.length === 0) {
    const e = document.createElement('div');
    e.className = 'conv-empty'; e.textContent = t('conv.emptyList');
    convListEl.appendChild(e); return;
  }
  for (const sess of filtered) {
    const r = state.runtime.get(sess.id);
    const busy = !!(r && r.busy);
    const item = document.createElement('div');
    item.className = 'conv-item' + (sess.id === state.activeId ? ' active' : '') + (busy ? '' : ' idle');
    item.dataset.id = sess.id;
    item.innerHTML =
      `<span class="ci-dot"></span><div class="ci-main">` +
      `<div class="ci-title">${escapeHtml(sess.title || t('conv.defaultTitle'))}</div>` +
      `<div class="ci-meta">${busy ? t('status.running') : t('status.idle')}</div></div>` +
      `<button class="ci-more" title="${escapeHtml(t('common.more'))}"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button>`;
    convListEl.appendChild(item);
  }
}
if (searchInput) searchInput.addEventListener('input', () => renderSessionList());
async function ensureBridgeSession(sess) {
  if (sess.bridgeSessionId) return sess.bridgeSessionId;
  const res = await window.ga.rpc('session/new', { cwd: '', mcp_servers: [] });
  if (res?.error) throw new Error(res.error.message || res.error);
  sess.bridgeSessionId = res.sessionId || res.result?.sessionId;
  return sess.bridgeSessionId;
}
async function newSession() {
  const localId = 'local-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  const sess = { id: localId, bridgeSessionId: null, title: t('conv.defaultTitle'), messages: [], untitled: true };
  state.sessions.set(localId, sess);
  try { await ensureBridgeSession(sess); } catch (e) { showError(t('err.newSession') + ': ' + (e.message || e)); }
  setActiveSession(localId);
  renderSessionList();
}
function setActiveSession(id) {
  state.activeId = id;
  const sess = state.sessions.get(id);
  if (!sess) return;
  if (msgsEl) msgsEl.innerHTML = '';
  rt(sess).draftEl = null;
  renderAllMessages(sess);
  setBusy(sess, rt(sess).busy);
  renderSessionList();
}
async function closeSession(id) {
  const sess = state.sessions.get(id);
  if (sess && sess.bridgeSessionId) {
    try { await window.ga.rpc('session/cancel', { sessionId: sess.bridgeSessionId }); } catch (_) {}
    fetch(`http://${location.hostname}:14168/session/${sess.bridgeSessionId}`, { method: 'DELETE' }).catch(() => {});
  }
  state.sessions.delete(id); state.runtime.delete(id);
  if (state.activeId === id) {
    const next = state.sessions.keys().next().value || null;
    if (next) setActiveSession(next);
    else { state.activeId = null; if (msgsEl) msgsEl.innerHTML = ''; refreshEmptyState(null); refreshStatusLabel(); }
  }
  renderSessionList();
}

const convMenu = document.getElementById('conv-menu');
let menuTargetId = null;
convListEl.addEventListener('click', (e) => {
  const more = e.target.closest('.ci-more');
  if (more) {
    e.stopPropagation();
    menuTargetId = more.closest('.conv-item').dataset.id;
    convMenu.hidden = false;
    const rect = more.getBoundingClientRect();
    convMenu.style.top = (rect.bottom + 4) + 'px';
    convMenu.style.left = (rect.right - convMenu.offsetWidth) + 'px';
    return;
  }
  const it = e.target.closest('.conv-item');
  if (it && it.dataset.id) setActiveSession(it.dataset.id);
});
convMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const act = e.target.closest('.ctx-item')?.dataset.act;
  const sess = menuTargetId && state.sessions.get(menuTargetId);
  if (sess && act === 'pin') {
    const m = new Map(); m.set(sess.id, sess);
    for (const [k, v] of state.sessions) if (k !== sess.id) m.set(k, v);
    state.sessions = m; renderSessionList();
  } else if (sess && act === 'del') {
    closeSession(sess.id);
  }
  convMenu.hidden = true;
});
document.addEventListener('click', () => { convMenu.hidden = true; });
newConvBtn.addEventListener('click', (e) => { e.preventDefault(); newSession(); });

/* ═══════════════ 轮询 + 流式 ═══════════════ */
function normalize(m) { return { id: Number(m.id || 0), role: m.role || 'system', content: m.content || '' }; }
function upsert(sess, raw, partial) {
  const m = normalize(raw); const r = rt(sess);
  if (partial && m.role === 'assistant') { r.draftText = m.content; if (isActive(sess)) renderDraft(sess); return; }
  if (!m.id || r.seen.has(m.id)) return;
  r.seen.add(m.id); r.lastId = Math.max(r.lastId, m.id);
  if (m.role === 'assistant' && r.draftEl) { r.draftEl.remove(); r.draftEl = null; r.draftText = ''; }
  sess.messages.push(m); appendMessage(sess, m);
}
async function pollSession(sess) {
  const r = rt(sess);
  if (r.polling) return;
  r.polling = true;
  try {
    do {
      const res = await window.ga.pollSession(sess.bridgeSessionId || sess.id, r.lastId || 0);
      if (res?.error) throw new Error(res.error.message || res.error);
      const result = res.result || res;
      for (const msg of (result.messages || [])) upsert(sess, msg, false);
      if (result.partial) upsert(sess, result.partial, true);
      const busy = result.status === 'running' || !!result.partial;
      setBusy(sess, busy);
      if (busy) await new Promise(z => setTimeout(z, 500));
      else { if (r.draftEl) { r.draftEl.remove(); r.draftEl = null; } break; }
    } while (true);
  } catch (e) {
    showError(t('err.poll') + ': ' + (e.message || e));
    setBusy(sess, false);
  } finally {
    r.polling = false; renderSessionList();
  }
}

/* ═══════════════ 发送 / 取消 ═══════════════ */
async function sendPrompt(text) {
  text = String(text || '').trim();
  if (!text) return;
  if (!state.bridgeReady) { showError(t('err.bridge')); return; }
  if (!state.activeId) { await newSession(); if (!state.activeId) return; }
  const sess = activeSess(); const r = rt(sess);
  if (r.busy) return;
  const userMsg = { role: 'user', content: text };
  sess.messages.push(userMsg); appendMessage(sess, userMsg);
  if (sess.untitled || isUntitled(sess.title)) {
    sess.title = text.slice(0, 40) + (text.length > 40 ? '…' : '');
    sess.untitled = false; renderSessionList();
  }
  setBusy(sess, true);
  try {
    const sid = await ensureBridgeSession(sess);
    const res = await window.ga.rpc('session/prompt', { sessionId: sid, prompt: text, images: [], llmNo: state.llmNo });
    if (res?.error) throw new Error(res.error.message || res.error);
    const uid = Number(res.userMessageId || res.result?.userMessageId || 0);
    if (uid) { r.seen.add(uid); r.lastId = Math.max(r.lastId, uid); }
    pollSession(sess);
  } catch (e) {
    const em = { role: 'error', content: e.message || String(e) };
    sess.messages.push(em); appendMessage(sess, em);
    setBusy(sess, false);
  }
}
async function cancelPrompt() {
  const sess = activeSess();
  if (!sess || !rt(sess).busy) return false;
  try {
    const res = await window.ga.rpc('session/cancel', { sessionId: sess.bridgeSessionId || sess.id });
    if (res?.error) throw new Error(res.error.message || res.error);
    return true;
  } catch (e) { showError(t('err.stop') + ': ' + (e.message || e)); return false; }
}

/* ═══════════════ 输入区 / slash / 预设 ═══════════════ */
function submitInput() {
  const text = inputEl.value;
  if (!text.trim()) return;
  inputEl.value = ''; inputEl.style.height = 'auto';
  if (text.trim().startsWith('/')) { handleSlash(text.trim()); return; }
  sendPrompt(text);
}
sendBtn.addEventListener('click', (e) => { e.preventDefault(); submitInput(); });
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitInput(); } });
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
});
function showSystem(text) {
  const sess = activeSess(); if (!sess) return;
  const m = { role: 'system', content: text };
  sess.messages.push(m); appendMessage(sess, m);
}
function showError(text) {
  const sess = activeSess();
  if (sess) { const m = { role: 'error', content: text }; sess.messages.push(m); appendMessage(sess, m); }
  else console.error(text);
}
async function handleSlash(cmd) {
  const name = cmd.slice(1).split(/\s+/)[0];
  switch (name) {
    case 'help': showSystem(t('slash.help')); break;
    case 'new': await newSession(); break;
    case 'clear': { const s = activeSess(); if (s) { s.messages = []; renderAllMessages(s); } break; }
    case 'stop': if (await cancelPrompt()) showSystem(t('sys.stopRequested')); break;
    case 'settings': openModal('settings-modal'); break;
    default: showSystem(t('slash.unknown') + ': /' + name);
  }
}
// 预设卡：按 data-preset 解耦（与翻译后的标题无关）
document.querySelectorAll('.fcard').forEach(card => {
  card.addEventListener('click', () => {
    const key = card.dataset.preset;
    if (!key || key === 'add') { inputEl.focus(); closeModals(); return; }
    const prompt = I18N[lang]['presetPrompt.' + key] || I18N.zh['presetPrompt.' + key];
    closeModals();
    if (prompt) sendPrompt(prompt);
  });
});

/* ═══════════════ 模型档位 ═══════════════ */
function updateModelChip() {
  if (modelNameEl) modelNameEl.textContent = state.modelName || t('model.auto');
}
async function loadModelProfiles() {
  try {
    const res = await window.ga.getModelProfiles();
    const list = res?.profiles || res?.result?.profiles || [];
    state.modelProfiles = list;
    const active = list.find(p => p.active) || list[0];
    if (active) { state.llmNo = active.id ?? 0; state.modelName = active.name || null; }
    updateModelChip();
  } catch (_) {}
}
if (modelChip) modelChip.addEventListener('click', (e) => {
  e.preventDefault();
  const list = state.modelProfiles || [];
  if (!list.length) return;
  const idx = list.findIndex(p => (p.id ?? 0) === state.llmNo);
  const next = list[(idx + 1) % list.length];
  state.llmNo = next.id ?? 0; state.modelName = next.name || null;
  updateModelChip();
});

/* ═══════════════ 上传按钮（占位）═══════════════ */
const uploadBtn = chatPage.querySelector('.composer-top .ic-btn');
if (uploadBtn) uploadBtn.addEventListener('click', (e) => { e.preventDefault(); showSystem(t('upload.hint')); });

/* ═══════════════ 语言切换 ═══════════════ */
if (langSel) {
  langSel.value = lang;
  langSel.addEventListener('change', () => {
    lang = (langSel.value === 'en') ? 'en' : 'zh';
    localStorage.setItem('ga_lang', lang);
    applyI18n();
    renderSessionList();
    refreshStatusLabel();
    updateModelChip();
  });
}

/* ═══════════════ bridge 事件 ═══════════════ */
window.ga.onBridgeReady(() => {
  state.bridgeReady = true;
  if (!state.activeId) { refreshStatusLabel(); refreshEmptyState(null); }
  loadModelProfiles();
});
window.ga.onBridgeNotification((msg) => {
  if (msg && msg.type === 'session-state') {
    for (const sess of state.sessions.values()) {
      if (sess.bridgeSessionId === msg.sessionId) {
        if (msg.status === 'running' || msg.state === 'running') pollSession(sess);
        renderSessionList();
        break;
      }
    }
  }
});
window.ga.onBridgeError((err) => { console.warn('[bridge error]', err); });
window.ga.onBridgeClosed(() => { state.bridgeReady = false; runLabel.textContent = t('status.disconnected'); });

/* ═══════════════ 启动 ═══════════════ */
applyI18n();
updateModelChip();
renderSessionList();
refreshEmptyState(null);
runLabel.textContent = t('status.connecting');
window.ga.startBridge && window.ga.startBridge();
