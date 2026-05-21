// GenericAgent 桌面版 —— bridge 适配 + 业务 UI（HTTP 命令 / WS 状态 / i18n）。
// 文案全部走 i18n：静态用 data-i18n / data-i18n-ph / data-i18n-title，
// 动态用 t(key)。dev 标注层与发给 agent 的预设 prompt 不进 UI 字典。
'use strict';

/* ═══════════════ 进程状态 store ═══════════════ */
const _serviceById = {};
const _serviceListeners = new Set();

function _serviceList() {
  return Object.values(_serviceById).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function _serviceNotify() {
  const items = _serviceList();
  for (const cb of _serviceListeners) {
    try { cb(items, _serviceById); } catch (e) { console.error('[service-store]', e); }
  }
}

const gaServiceStore = {
  applySnapshot(services) {
    for (const k of Object.keys(_serviceById)) delete _serviceById[k];
    for (const s of services || []) {
      if (s && s.id) _serviceById[s.id] = s;
    }
    _serviceNotify();
  },
  applyChanged(service) {
    if (service && service.id) _serviceById[service.id] = service;
    _serviceNotify();
  },
  onServices(cb) {
    _serviceListeners.add(cb);
    cb(_serviceList(), _serviceById);
    return () => _serviceListeners.delete(cb);
  },
  list: _serviceList,
  get: (id) => _serviceById[id],
};

/* ═══════════════ Bridge 适配（HTTP 命令 + WS 状态） ═══════════════ */
(function initGaBridge() {
  const listeners = new Map();
  let ws = null;
  let cachedBridgeReady = null;
  const bridgeBase = `${location.protocol}//${location.hostname}:14168`;
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:14168/ws`;

  function on(channel, cb) {
    if (typeof cb !== 'function') return () => {};
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(cb);
    if (channel === 'bridge-ready' && cachedBridgeReady) {
      try { cb(cachedBridgeReady); } catch (err) { console.error('[ga bridge] replay bridge-ready', err); }
    }
    return () => listeners.get(channel)?.delete(cb);
  }

  function emit(channel, payload) {
    if (channel === 'bridge-ready') cachedBridgeReady = payload;
    const set = listeners.get(channel);
    if (!set) return;
    for (const cb of Array.from(set)) {
      try { cb(payload); } catch (err) { console.error('[ga bridge]', channel, err); }
    }
  }

  function handleServiceWs(msg) {
    if (msg.type === 'services.snapshot') gaServiceStore.applySnapshot(msg.services);
    else if (msg.type === 'service.changed') gaServiceStore.applyChanged(msg.service);
    emit('service-state', msg);
  }

  async function http(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    const init = Object.assign({}, options, { headers });
    if (init.body && typeof init.body !== 'string') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      init.body = JSON.stringify(init.body);
    }
    const res = await fetch(`${bridgeBase}${path}`, init);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || `${res.status} ${res.statusText}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try {
      ws = new WebSocket(wsUrl);
      ws.addEventListener('open', () => emit('bridge-log', 'WS connected'));
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }
        if (msg.type === 'bridge-ready') emit('bridge-ready', msg);
        else if (msg.type === 'services.snapshot' || msg.type === 'service.changed') handleServiceWs(msg);
        else if (msg.type === 'session-state') emit('bridge-notification', msg);
        else if (msg.type === 'bridge-log') emit('bridge-log', msg.payload || msg);
        else if (msg.type === 'bridge-error') emit('bridge-error', msg.payload || msg);
      });
      ws.addEventListener('close', () => emit('bridge-closed', { reason: 'ws-closed' }));
      ws.addEventListener('error', () => emit('bridge-error', { type: 'ws-error', message: 'WebSocket error' }));
    } catch (err) {
      emit('bridge-error', { type: 'ws-error', message: err.message || String(err) });
    }
  }

  async function rpc(method, params = {}) {
    switch (method) {
      case 'app/status': return http('/status');
      case 'app/config/get': return http('/config');
      case 'app/config/save': return http('/config', { method: 'POST', body: params || {} });
      case 'get/model-profiles': return http('/model-profiles');
      case 'session/new': return http('/session/new', { method: 'POST', body: params || {} });
      case 'session/prompt': {
        const sid = params.sessionId || params.id || params.bridgeSessionId;
        if (!sid) throw new Error('session/prompt missing sessionId');
        return http(`/session/${encodeURIComponent(sid)}/prompt`, { method: 'POST', body: params || {} });
      }
      case 'session/poll': {
        const sid = params.sessionId || params.id || params.bridgeSessionId;
        if (!sid) throw new Error('session/poll missing sessionId');
        const after = params.afterId ?? params.after ?? 0;
        const limit = params.limit ?? 200;
        return http(`/session/${encodeURIComponent(sid)}/messages?after=${encodeURIComponent(after)}&limit=${encodeURIComponent(limit)}`);
      }
      case 'session/cancel': {
        const sid = params.sessionId || params.id || params.bridgeSessionId;
        if (!sid) throw new Error('session/cancel missing sessionId');
        return http(`/session/${encodeURIComponent(sid)}/cancel`, { method: 'POST', body: params || {} });
      }
      case 'app/path/open': return http('/path/open', { method: 'POST', body: params || {} });
      case 'services/start': {
        const id = params.id;
        if (!id) throw new Error('services/start missing id');
        return http('/services/start', { method: 'POST', body: { id } });
      }
      case 'services/stop': {
        const id = params.id;
        if (!id) throw new Error('services/stop missing id');
        return http('/services/stop', { method: 'POST', body: { id } });
      }
      case 'services/logs': {
        const id = params.id;
        if (!id) throw new Error('services/logs missing id');
        const tail = params.tail ?? 200;
        return http(`/services/logs?id=${encodeURIComponent(id)}&tail=${encodeURIComponent(tail)}`);
      }
      case 'services/panel': return http('/services/panel');
      case 'services/mykey/get': return http('/services/mykey');
      case 'services/mykey/save': return http('/services/mykey', { method: 'POST', body: params || {} });
      case 'app/path/selectGaRoot': return http('/config');
      case 'list_continuable_sessions': return { sessions: [] };
      case 'restore_session': throw new Error('restore_session is not implemented in web2 bridge');
      default: throw new Error(`Unknown RPC method: ${method}`);
    }
  }

  async function startService(id) {
    try {
      const res = await rpc('services/start', { id });
      if (res.service) gaServiceStore.applyChanged(res.service);
      return res;
    } catch (e) {
      if (e.data && e.data.service) gaServiceStore.applyChanged(e.data.service);
      throw e;
    }
  }

  async function stopService(id) {
    const res = await rpc('services/stop', { id });
    if (res.service) gaServiceStore.applyChanged(res.service);
    return res;
  }

  window.ga = {
    platform: navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'win32',
    startBridge: async () => { connectWs(); return http('/status'); },
    stopBridge: async () => ({ ok: true }),
    checkStatus: () => rpc('app/status', {}),
    getConfig: () => rpc('app/config/get', {}),
    saveConfig: (cfg) => rpc('app/config/save', cfg || {}),
    getModelProfiles: () => rpc('get/model-profiles', {}),
    selectGaRoot: () => rpc('app/path/selectGaRoot', {}),
    openMykeyTemplate: () => rpc('app/path/open', { kind: 'mykeyTemplate' }),
    openMykey: () => rpc('app/path/open', { kind: 'mykey' }),
    startService,
    stopService,
    getServiceLogs: (id, tail = 200) => rpc('services/logs', { id, tail }),
    getServicePanel: () => rpc('services/panel', {}),
    getMykeyContent: () => rpc('services/mykey/get', {}),
    saveMykeyContent: (content) => rpc('services/mykey/save', { content }),
    pollSession: (sessionId, afterId = 0) => rpc('session/poll', { sessionId, afterId }),
    rpc,
    onBridgeMessage: (cb) => on('bridge-message', cb),
    onBridgeNotification: (cb) => on('bridge-notification', cb),
    onBridgeError: (cb) => on('bridge-error', cb),
    onBridgeClosed: (cb) => on('bridge-closed', cb),
    onBridgeReady: (cb) => on('bridge-ready', cb),
    onBridgeLog: (cb) => on('bridge-log', cb),
    onServiceState: (cb) => on('service-state', cb),
    onOpenSearch: (cb) => on('open-search', cb),
  };

  connectWs();
  http('/status').then(status => emit('bridge-ready', status))
    .catch(err => emit('bridge-error', { type: 'http-error', message: err.message || String(err) }));
})();

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
    'ctx.pin': '置顶', 'ctx.unpin': '取消置顶', 'ctx.del': '删除',
    'common.close': '关闭', 'common.more': '更多', 'common.optional': '选填', 'common.save': '保存',
    'modal.preset': '预设功能', 'modal.addModel': '添加模型', 'modal.editModel': '编辑模型', 'modal.settings': '配置',
    'set.appearance': '外观', 'set.plainUi': '素色', 'set.theme': '颜色', 'set.lang': '语言', 'set.model': '模型', 'set.addModel': '添加模型',
    'appearance.light': '浅色', 'appearance.dark': '深色',
    'set.noModels': '暂无模型，点击下方添加',
    'lang.zh': '简体中文', 'lang.en': 'English',
    'model.name': '备注', 'model.namePh': '会显示在模型列表',
    'model.apikey': 'API Key', 'model.apikeyPh': 'sk-...', 'model.apikeyKeep': '留空则保持原 Key 不变',
    'model.apibase': 'API 地址', 'model.apibasePh': 'https://.../v1/messages',
    'model.protocol': '协议', 'model.protocolPick': '请选择…', 'model.protocolOai': 'OpenAI 兼容 (chat/completions)', 'model.protocolClaude': 'Anthropic (Claude /v1/messages)',
    'model.model': '模型', 'model.modelPh': 'model 参数名',
    'model.modelHint': '须与中转站/官方文档中的 model 字段完全一致',
    'model.retries': '重试 (次)', 'model.connTimeout': '连接超时 (s)', 'model.readTimeout': '读取超时 (s)',
    'model.save': '保存', 'common.cancel': '取消', 'common.edit': '编辑', 'common.delete': '删除',
    'err.modelSave': '保存失败', 'err.modelRequired': '请填写模型、API Key 和 API 地址',
    'err.modelDelete': '删除失败', 'err.modelDeleteLast': '至少保留一个模型',
    'confirm.modelDelete': '确定删除该模型配置？',
    'page.channels.title': '消息通道', 'page.channels.sub': '后台 IM 进程：列表、启停与日志（同 hub.pyw）',
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
    'ch.qq': 'QQ', 'ch.telegram': 'Telegram', 'ch.discord': 'Discord',
    'ch.loading': '加载中…', 'ch.empty': '未发现 IM 进程脚本',
    'ch.logEmpty': '暂无日志',
    'err.channelLoad': '加载失败', 'err.channelStart': '启动失败', 'err.channelStop': '停止失败',
    'err.channelNotConfigured': '请先在 mykey.py 中配置该平台',
    'sys.channelStarted': '已启动', 'sys.channelStopped': '已停止',
    'modal.channelLogs': '进程日志',
    'modal.mykeyConfig': 'mykey.py 配置',
    'sys.configSaved': '配置已保存',
    'st.starting': '启动中…', 'st.stopping': '停止中…',
    'st.online': '在线', 'st.offline': '离线', 'st.error': '错误', 'st.running': '运行', 'st.abnormal': '异常',
    'act.configure': '配置', 'act.logs': '日志', 'act.restart': '重启', 'act.stop': '停止', 'act.start': '启动',
    'proc.imbotWechat': 'imbot · 微信', 'proc.imbotDing': 'imbot · 钉钉', 'proc.scheduler': '定时任务调度',
    'cm.scheduling': '调度中', 'cm.running': '执行中', 'cm.idleSt': '空闲',
    'cm.master': '已派 3 子任务', 'cm.w1': '子任务：抓取数据', 'cm.w2': '子任务：复核结果', 'cm.sub': '等待派单',
    'tok.total': '累计 token', 'tok.cost': '估算成本', 'tok.today': '今日 token',
    'tok.colSession': '会话', 'tok.colIn': '输入', 'tok.colOut': '输出', 'tok.colCacheW': '缓存写入', 'tok.colCache': '缓存读取', 'tok.colCost': '成本',
    'tok.from': '从', 'tok.to': '到', 'tok.reset': '重置', 'tok.noData': '暂无记录',
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
    'ctx.pin': 'Pin', 'ctx.unpin': 'Unpin', 'ctx.del': 'Delete',
    'common.close': 'Close', 'common.more': 'More', 'common.optional': 'Optional', 'common.save': 'Save',
    'modal.preset': 'Presets', 'modal.addModel': 'Add model', 'modal.editModel': 'Edit model', 'modal.settings': 'Settings',
    'set.appearance': 'Appearance', 'set.plainUi': 'Plain', 'set.theme': 'Color', 'set.lang': 'Language', 'set.model': 'Model', 'set.addModel': 'Add model',
    'appearance.light': 'Light', 'appearance.dark': 'Dark',
    'set.noModels': 'No models yet — add one below',
    'lang.zh': '简体中文', 'lang.en': 'English',
    'model.name': 'Note', 'model.namePh': 'Shown in the model list',
    'model.apikey': 'API Key', 'model.apikeyPh': 'sk-...', 'model.apikeyKeep': 'Leave blank to keep the current key',
    'model.apibase': 'API base URL', 'model.apibasePh': 'https://.../v1/messages',
    'model.protocol': 'Protocol', 'model.protocolPick': 'Select…', 'model.protocolOai': 'OpenAI-compatible (chat/completions)', 'model.protocolClaude': 'Anthropic (Claude /v1/messages)',
    'model.model': 'Model', 'model.modelPh': 'model parameter name',
    'model.modelHint': 'Must match the model field in your provider docs exactly',
    'model.retries': 'Retries (×)', 'model.connTimeout': 'Connect (s)', 'model.readTimeout': 'Read (s)',
    'model.save': 'Save', 'common.cancel': 'Cancel', 'common.edit': 'Edit', 'common.delete': 'Delete',
    'err.modelSave': 'Save failed', 'err.modelRequired': 'Model, API Key and base URL are required',
    'err.modelDelete': 'Delete failed', 'err.modelDeleteLast': 'At least one model is required',
    'confirm.modelDelete': 'Delete this model profile?',
    'page.channels.title': 'Channels', 'page.channels.sub': 'Background IM processes: list, start/stop, logs (hub.pyw style)',
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
    'ch.qq': 'QQ', 'ch.telegram': 'Telegram', 'ch.discord': 'Discord',
    'ch.loading': 'Loading…', 'ch.empty': 'No IM process scripts found',
    'ch.logEmpty': 'No log output yet',
    'err.channelLoad': 'Failed to load', 'err.channelStart': 'Start failed', 'err.channelStop': 'Stop failed',
    'err.channelNotConfigured': 'Configure this platform in mykey.py first',
    'sys.channelStarted': 'Started', 'sys.channelStopped': 'Stopped',
    'modal.channelLogs': 'Process logs',
    'modal.mykeyConfig': 'mykey.py',
    'sys.configSaved': 'Configuration saved',
    'st.starting': 'Starting…', 'st.stopping': 'Stopping…',
    'st.online': 'Online', 'st.offline': 'Offline', 'st.error': 'Error', 'st.running': 'Running', 'st.abnormal': 'Error',
    'act.configure': 'Configure', 'act.logs': 'Logs', 'act.restart': 'Restart', 'act.stop': 'Stop', 'act.start': 'Start',
    'proc.imbotWechat': 'imbot · WeChat', 'proc.imbotDing': 'imbot · DingTalk', 'proc.scheduler': 'Scheduler',
    'cm.scheduling': 'Scheduling', 'cm.running': 'Running', 'cm.idleSt': 'Idle',
    'cm.master': 'Dispatched 3 subtasks', 'cm.w1': 'Subtask: fetch data', 'cm.w2': 'Subtask: review results', 'cm.sub': 'Waiting for tasks',
    'tok.total': 'Total tokens', 'tok.cost': 'Est. cost', 'tok.today': 'Today tokens',
    'tok.colSession': 'Session', 'tok.colIn': 'Input', 'tok.colOut': 'Output', 'tok.colCacheW': 'Cache write', 'tok.colCache': 'Cache read', 'tok.colCost': 'Cost',
    'tok.from': 'From', 'tok.to': 'To', 'tok.reset': 'Reset', 'tok.noData': 'No records',
    'presetPrompt.goal': 'Enter Goal mode: read the L3 goal-mode SOP and autonomously achieve the goal I describe next.',
    'presetPrompt.explore': 'Enter auto-explore mode: browse autonomously and periodically summarize key points to me.',
    'presetPrompt.hive': 'Start Goal Hive mode: per the hive SOP, spawn multiple workers to collaboratively achieve the goal I describe next.',
    'presetPrompt.review': 'Enter reviewer mode: strictly scrutinize the previous output, review item by item and report issues.',
    'presetPrompt.mine': 'Collect this week\'s git commits and write a weekly report.',
  },
};
const LANGS = ['zh', 'en'];
let lang = LANGS.includes(localStorage.getItem('ga_lang')) ? localStorage.getItem('ga_lang') : 'zh';
let theme = localStorage.getItem('ga_theme') || '1';
const STORE = { lang: 'ga_lang', theme: 'ga_theme', appearance: 'ga_appearance', plain: 'ga_plain', llmNo: 'ga_llm_no', sessions: 'ga_sessions', activeId: 'ga_active_id' };
const APPEARANCE_IDS = ['light', 'dark'];
const LEGACY_STYLE = { classic: ['light', true], tinted: ['light', false], dark: ['dark', false] };

function migrateAppearance() {
  let app = localStorage.getItem(STORE.appearance);
  let plain = localStorage.getItem(STORE.plain) === '1';
  const legacy = localStorage.getItem('ga_style');
  if (!app && legacy && LEGACY_STYLE[legacy]) {
    [app, plain] = LEGACY_STYLE[legacy];
    localStorage.setItem(STORE.appearance, app);
    if (plain) localStorage.setItem(STORE.plain, '1');
    else localStorage.removeItem(STORE.plain);
    localStorage.removeItem('ga_style');
  }
  if (!APPEARANCE_IDS.includes(app)) app = 'light';
  return { appearance: app, plain: plain && app === 'light' };
}
let { appearance, plain: plainUi } = migrateAppearance();
const bridgeHost = () => `${location.protocol}//${location.hostname}:14168`;
async function bridgeFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const init = { ...opts, headers };
  if (init.body && typeof init.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  const res = await fetch(`${bridgeHost()}${path}`, init);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(data.error || data.message || res.statusText);
  return data;
}
function t(key) { return (I18N[lang] && I18N[lang][key]) || (I18N.zh[key]) || key; }
function optionalPh(key) {
  const sep = (lang === 'en') ? ', ' : '，';
  return `${t('common.optional')}${sep}${t(key)}`;
}
function applyI18n() {
  document.documentElement.lang = (lang === 'en') ? 'en' : 'zh-CN';
  document.title = t('app.title');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const phKey = el.dataset.i18nPh;
    el.setAttribute('placeholder', el.hasAttribute('data-optional-ph') ? optionalPh(phKey) : t(phKey));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', t(el.dataset.i18nTitle)); });
  renderLangList();
}
// 语言对应国旗 SVG(en 用美国旗,按要求)
const FLAGS = {
  zh: '<svg class="flag" viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="30" height="20" fill="#ee1c25"/><polygon points="6,3.5 6.9,6.2 9.7,6.2 7.4,7.9 8.3,10.6 6,8.9 3.7,10.6 4.6,7.9 2.3,6.2 5.1,6.2" fill="#ffde00"/><circle cx="11.5" cy="2.6" r=".9" fill="#ffde00"/><circle cx="13.2" cy="4.3" r=".9" fill="#ffde00"/><circle cx="13.2" cy="6.7" r=".9" fill="#ffde00"/><circle cx="11.5" cy="8.4" r=".9" fill="#ffde00"/></svg>',
  en: '<svg class="flag" viewBox="0 0 38 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="38" height="20" fill="#ffffff"/><g fill="#b22234"><rect width="38" height="1.54"/><rect y="3.08" width="38" height="1.54"/><rect y="6.16" width="38" height="1.54"/><rect y="9.24" width="38" height="1.54"/><rect y="12.32" width="38" height="1.54"/><rect y="15.4" width="38" height="1.54"/><rect y="18.48" width="38" height="1.54"/></g><rect width="15.2" height="10.78" fill="#3c3b6e"/></svg>',
};
function renderLangList() {
  const box = document.getElementById('lang-list');
  if (!box) return;
  box.innerHTML = '';
  LANGS.forEach(code => {
    const row = document.createElement('label');
    row.className = 'model-row' + (lang === code ? ' sel' : '');
    row.innerHTML = `<input type="radio" name="lang-pick"${lang === code ? ' checked' : ''}>${FLAGS[code] || ''}<span>${escapeHtml(t('lang.' + code))}</span>`;
    row.addEventListener('click', (e) => { e.preventDefault(); selectLang(code); });
    box.appendChild(row);
  });
}
function selectLang(code) {
  if (!LANGS.includes(code) || lang === code) return;
  lang = code;
  localStorage.setItem(STORE.lang, lang);
  applyI18n();
  renderSessionList();
  refreshStatusLabel();
  updateModelChip();
  renderSettingsModels();
  if (document.querySelector('.page[data-page="channels"].active')) renderChannelList(gaServiceStore.list());
  if (document.querySelector('.page[data-page="status"].active')) loadStatusPanel();
}
function applyTheme(id) {
  const n = parseInt(id, 10);
  theme = (n >= 1 && n <= 8) ? String(n) : '1';
  const root = document.documentElement;
  root.dataset.theme = theme;
  localStorage.setItem(STORE.theme, theme);
  root.style.setProperty('--blue', getComputedStyle(root).getPropertyValue(`--swatch-${theme}`).trim());
  document.querySelectorAll('#theme-swatches .swatch').forEach(el => {
    el.classList.toggle('sel', el.dataset.theme === theme);
  });
}
function syncPlainSwitch() {
  const row = document.getElementById('plain-ui-row');
  const sw = document.getElementById('plain-ui-switch');
  if (!row || !sw) return;
  const show = appearance === 'light';
  row.hidden = !show;
  sw.setAttribute('aria-checked', plainUi ? 'true' : 'false');
}
function applyAppearance(nextApp, nextPlain) {
  appearance = APPEARANCE_IDS.includes(nextApp) ? nextApp : 'light';
  if (appearance === 'light') {
    plainUi = !!nextPlain;
    if (plainUi) localStorage.setItem(STORE.plain, '1');
    else localStorage.removeItem(STORE.plain);
  } else {
    plainUi = false;
  }
  localStorage.setItem(STORE.appearance, appearance);
  document.documentElement.dataset.appearance = appearance;
  if (plainUi) document.documentElement.dataset.plain = '1';
  else delete document.documentElement.dataset.plain;
  document.querySelectorAll('#appearance-seg .appear-card').forEach(el => {
    const on = el.dataset.appearance === appearance;
    el.classList.toggle('sel', on);
    el.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  syncPlainSwitch();
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
bindClick('add-model-btn', (e) => {
  e.stopPropagation();
  openAddModelForm();
});
bindClick('settings-btn',  (e) => { e.stopPropagation(); openSettings(); });
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
/** GA list_llms 形如 SessionClass/备注；桌面 UI 只展示 / 后一段 */
function profileLabel(name) {
  const s = String(name || '');
  const i = s.indexOf('/');
  return (i >= 0 ? s.slice(i + 1) : s).trim();
}
function normalizeProfiles(list) {
  return (list || []).map(p => ({ ...p, name: profileLabel(p.name) || p.name }));
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

function saveSessions() {
  try {
    const arr = [...state.sessions.values()].map(s => ({
      id: s.id, bridgeSessionId: s.bridgeSessionId, title: s.title,
      untitled: s.untitled, pinned: s.pinned,
      lastActiveTs: s.lastActiveTs
    }));
    localStorage.setItem(STORE.sessions, JSON.stringify(arr));
    if (state.activeId) localStorage.setItem(STORE.activeId, state.activeId);
  } catch (_) {}
}
function loadSessions() {
  try {
    const raw = localStorage.getItem(STORE.sessions);
    if (!raw) return;
    const arr = JSON.parse(raw);
    for (const s of arr) {
      s.messages = s.messages || [];
      state.sessions.set(s.id, s);
    }
    const savedActive = localStorage.getItem(STORE.activeId);
    if (savedActive && state.sessions.has(savedActive)) state.activeId = savedActive;
    else if (state.sessions.size) state.activeId = state.sessions.keys().next().value;
  } catch (_) {}
}

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

const sbToggle = document.getElementById('sb-toggle');
const sbResize = document.getElementById('sb-resize');
const sbPanel  = document.querySelector('.sidebar');
if (sbToggle) sbToggle.addEventListener('click', () => bodyEl.classList.toggle('sb-collapsed'));

// 通用拖拽：dir=+1 拖动 →clientX 增大就增宽(左侧栏);dir=-1 反之(右侧)
function bindResize(handle, panel, dir, min, max) {
  if (!handle || !panel) return;
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener('mousedown', (e) => {
    dragging = true; startX = e.clientX; startW = panel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.min(max, Math.max(min, startW + dir * (e.clientX - startX)));
    panel.style.width = w + 'px';
    panel.style.flex = '0 0 ' + w + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}
bindResize(rpResize, rpPanel, -1, 160, 400);  // 右栏:cursor 左移 → 增宽
bindResize(sbResize, sbPanel, +1, 180, 360);  // 左栏:cursor 右移 → 增宽
const modelChip  = document.getElementById('model-chip');
const modelNameEl= modelChip ? modelChip.querySelector('.model-name') : null;

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
  const all = [...state.sessions.values()]
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.lastActiveTs || 0) - (a.lastActiveTs || 0);
    });
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
    const pinSvg = sess.pinned ? `<svg class="ci-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z"/></svg>` : '';
    item.innerHTML =
      `<span class="ci-dot"></span><div class="ci-main">` +
      `<div class="ci-title">${pinSvg}${escapeHtml(sess.title || t('conv.defaultTitle'))}</div>` +
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
  const sess = { id: localId, bridgeSessionId: null, title: t('conv.defaultTitle'), messages: [], untitled: true, lastActiveTs: Date.now() };
  state.sessions.set(localId, sess);
  try { await ensureBridgeSession(sess); } catch (e) { showError(t('err.newSession') + ': ' + (e.message || e)); }
  setActiveSession(localId);
  saveSessions();
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
  localStorage.setItem(STORE.activeId, id);
  if (sess.bridgeSessionId && !sess.messages.length && state.bridgeReady) {
    pollSession(sess);
  }
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
  saveSessions();
  renderSessionList();
}

const convMenu = document.getElementById('conv-menu');
let menuTargetId = null;
convListEl.addEventListener('click', (e) => {
  const more = e.target.closest('.ci-more');
  if (more) {
    e.stopPropagation();
    menuTargetId = more.closest('.conv-item').dataset.id;
    // 根据当前会话置顶状态切菜单文案:置顶 / 取消置顶
    const tgt = state.sessions.get(menuTargetId);
    const pinSpan = convMenu.querySelector('[data-act="pin"] [data-i18n]');
    if (pinSpan) {
      const k = tgt && tgt.pinned ? 'ctx.unpin' : 'ctx.pin';
      pinSpan.setAttribute('data-i18n', k);
      pinSpan.textContent = t(k);
    }
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
    if (sess.pinned) {
      sess.pinned = false;       // 取消置顶 + 放到 pinned 之后、其它 unpinned 之前(unpinned 区域顶部)
      const others = [...state.sessions.values()].filter(s => s.id !== sess.id);
      const m = new Map();
      for (const s of others) if (s.pinned) m.set(s.id, s);  // 先所有仍 pinned 的
      m.set(sess.id, sess);                                   // 再本会话(刚 unpinned)
      for (const s of others) if (!s.pinned) m.set(s.id, s);  // 再其它 unpinned
      state.sessions = m;
    } else {
      sess.pinned = true;        // 置顶 + 移到列表顶
      const m = new Map(); m.set(sess.id, sess);
      for (const [k, v] of state.sessions) if (k !== sess.id) m.set(k, v);
      state.sessions = m;
    }
    saveSessions();
    renderSessionList();
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
  saveSessions();
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
      else {
        // 退出 poll：若草稿还在(取消时 bridge 不发 final),把已流式输出的文本定稿,加 [已停止] 标记
        if (r.draftEl) {
          if (r.draftText && r.draftText.trim()) {
            const m = { role:'assistant', content: r.draftText + '\n\n_[' + t('status.stopped') + ']_' };
            sess.messages.push(m);
            r.draftEl.remove(); r.draftEl = null; r.draftText = '';
            if (isActive(sess)) appendMessage(sess, m);
            saveSessions();
          } else {
            r.draftEl.remove(); r.draftEl = null;
          }
        }
        break;
      }
    } while (true);
  } catch (e) {
    showError(t('err.poll') + ': ' + (e.message || e));
    setBusy(sess, false);
  } finally {
    r.polling = false; renderSessionList();
    tokPollBridge();
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
  sess.lastActiveTs = Date.now();
  if (sess.untitled || isUntitled(sess.title)) {
    sess.title = text.slice(0, 40) + (text.length > 40 ? '…' : '');
    sess.untitled = false; renderSessionList();
  }
  saveSessions();
  setBusy(sess, true);
  try {
    let sid = await ensureBridgeSession(sess);
    try {
      await bridgeFetch(`/session/${encodeURIComponent(sid)}/restore`, { method: 'POST', body: {} });
    } catch (restoreErr) {
      if (/not found/i.test(restoreErr.message || '')) {
        sess.bridgeSessionId = null;
        sid = await ensureBridgeSession(sess);
        saveSessions();
      }
    }
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
    case 'settings': openSettings(); break;
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

/* ═══════════════ 模型 / 设置 ═══════════════ */
function updateModelChip() {
  if (modelNameEl) modelNameEl.textContent = state.modelName || t('model.auto');
}
async function selectModel(id, name) {
  state.llmNo = id;
  state.modelName = profileLabel(name) || name || null;
  localStorage.setItem(STORE.llmNo, String(id));
  updateModelChip();
  renderSettingsModels();
  try { await window.ga.saveConfig({ config: { llmNo: id } }); } catch (_) {}
}
const MODEL_ACT_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const MODEL_ACT_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
let editingModelId = null;

function setModelApikeyMode(isAdd) {
  const apikey = document.getElementById('model-apikey-input');
  const apikeyReq = document.querySelector('#model-apikey-label .field-req');
  if (!apikey) return;
  apikey.required = isAdd;
  apikey.dataset.i18nPh = isAdd ? 'model.apikeyPh' : 'model.apikeyKeep';
  if (isAdd) apikey.removeAttribute('data-optional-ph');
  else { apikey.value = ''; apikey.setAttribute('data-optional-ph', ''); }
  if (apikeyReq) apikeyReq.hidden = !isAdd;
}

function openAddModelForm() {
  editingModelId = null;
  const form = document.getElementById('add-model-form');
  const title = document.getElementById('model-form-title');
  const errEl = document.getElementById('add-model-err');
  if (title) title.dataset.i18n = 'modal.addModel';
  if (form) form.reset();
  setModelApikeyMode(true);
  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  openModal('add-model-modal');
  applyI18n();
}
async function openEditModelForm(id) {
  editingModelId = id;
  const errEl = document.getElementById('add-model-err');
  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  try {
    const res = await bridgeFetch(`/model-profiles/${id}`);
    const p = res.profile;
    if (!p) throw new Error(t('err.modelSave'));
    const form = document.getElementById('add-model-form');
    const title = document.getElementById('model-form-title');
    if (title) title.dataset.i18n = 'modal.editModel';
    if (form) {
      form.model.value = p.model || '';
      form.apibase.value = p.apibase || '';
      form.name.value = p.name || '';
      form.max_retries.value = p.max_retries ?? 5;
      form.connect_timeout.value = p.connect_timeout ?? 15;
      form.read_timeout.value = p.read_timeout ?? 300;
      // 编辑模式:按 varName 回填协议分段控件
      const pv = /claude/i.test(p.varName || '') ? 'claude' : 'oai';
      const pr = form.querySelector(`input[name="protocol"][value="${pv}"]`);
      if (pr) pr.checked = true;
    }
    setModelApikeyMode(false);
    openModal('add-model-modal');
    applyI18n();
  } catch (ex) {
    alert(ex.message || t('err.modelSave'));
  }
}
async function deleteModel(id, name) {
  const label = profileLabel(name) || name || ('#' + id);
  if (!confirm(`${t('confirm.modelDelete')}\n${label}`)) return;
  try {
    const res = await bridgeFetch(`/model-profiles/${id}`, { method: 'DELETE', body: {} });
    if (res?.ok === false || res?.error) throw new Error(res.error || t('err.modelDelete'));
    const wasActive = state.llmNo === id;
    const oldNo = state.llmNo;
    state.modelProfiles = normalizeProfiles(res.profiles || []);
    if (wasActive) {
      const p = state.modelProfiles[0];
      if (p) await selectModel(p.id ?? 0, p.name);
      else { state.llmNo = 0; state.modelName = null; updateModelChip(); }
    } else if (oldNo > id) {
      const p = state.modelProfiles[oldNo - 1];
      if (p) await selectModel(p.id ?? (oldNo - 1), p.name);
    }
    renderSettingsModels();
  } catch (ex) {
    const msg = ex.message || '';
    alert(msg.includes('last profile') ? t('err.modelDeleteLast') : (msg || t('err.modelDelete')));
  }
}
function renderSettingsModels() {
  const box = document.getElementById('model-list');
  if (!box) return;
  box.innerHTML = '';
  const list = state.modelProfiles || [];
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'set-empty'; empty.textContent = t('set.noModels');
    box.appendChild(empty); return;
  }
  for (const p of list) {
    const id = p.id ?? 0;
    const label = profileLabel(p.name) || p.name || ('#' + id);
    const row = document.createElement('label');
    row.className = 'model-row' + (state.llmNo === id ? ' sel' : '');
    row.innerHTML = `<input type="radio" name="model-pick"${state.llmNo === id ? ' checked' : ''}><span class="model-row-name">${escapeHtml(label)}</span><span class="model-row-actions"><button type="button" class="model-act" data-act="edit" title="${escapeHtml(t('common.edit'))}">${MODEL_ACT_EDIT}</button><button type="button" class="model-act model-act-del" data-act="delete" title="${escapeHtml(t('common.delete'))}">${MODEL_ACT_DEL}</button></span>`;
    row.querySelector('[data-act="edit"]').addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); openEditModelForm(id); });
    row.querySelector('[data-act="delete"]').addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); deleteModel(id, p.name); });
    row.addEventListener('click', (e) => {
      if (e.target.closest('.model-row-actions')) return;
      e.preventDefault();
      selectModel(id, p.name);
    });
    box.appendChild(row);
  }
}
function openSettings() {
  openModal('settings-modal');
  renderSettingsModels();
  renderLangList();
  applyTheme(theme);
  applyAppearance(appearance, plainUi);
}
async function loadModelProfiles() {
  try {
    const res = await window.ga.getModelProfiles();
    const list = res?.profiles || res?.result?.profiles || [];
    state.modelProfiles = normalizeProfiles(list);
    const saved = localStorage.getItem(STORE.llmNo);
    if (saved != null && list.length) {
      const n = parseInt(saved, 10);
      const p = state.modelProfiles.find(x => (x.id ?? 0) === n);
      if (p) { state.llmNo = n; state.modelName = profileLabel(p.name) || p.name || null; }
    } else {
      const active = state.modelProfiles.find(p => p.active) || state.modelProfiles[0];
      if (active) { state.llmNo = active.id ?? 0; state.modelName = profileLabel(active.name) || active.name || null; }
    }
    updateModelChip();
    renderSettingsModels();
  } catch (_) {}
}
if (modelChip) modelChip.addEventListener('click', (e) => {
  e.preventDefault();
  const list = state.modelProfiles || [];
  if (!list.length) { openSettings(); return; }
  const idx = list.findIndex(p => (p.id ?? 0) === state.llmNo);
  const next = list[(idx + 1) % list.length];
  selectModel(next.id ?? 0, next.name);
});
const themeSwatches = document.getElementById('theme-swatches');
if (themeSwatches) themeSwatches.addEventListener('click', (e) => {
  const sw = e.target.closest('.swatch[data-theme]');
  if (sw) applyTheme(sw.dataset.theme);
});
const appearanceSeg = document.getElementById('appearance-seg');
if (appearanceSeg) appearanceSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.appear-card[data-appearance]');
  if (!btn) return;
  const isLight = btn.dataset.appearance === 'light';
  applyAppearance(btn.dataset.appearance, isLight && localStorage.getItem(STORE.plain) === '1');
});
const plainUiSwitch = document.getElementById('plain-ui-switch');
if (plainUiSwitch) plainUiSwitch.addEventListener('click', () => {
  if (appearance === 'light') applyAppearance('light', !plainUi);
});
async function loadBridgeConfig() {
  try {
    const res = await window.ga.getConfig();
    const cfg = res?.config || {};
    if (cfg.llmNo != null && state.modelProfiles.length) {
      const p = state.modelProfiles.find(x => (x.id ?? 0) === cfg.llmNo);
      if (p) { state.llmNo = cfg.llmNo; state.modelName = p.name || null; updateModelChip(); }
    }
  } catch (_) {}
}

const addModelForm = document.getElementById('add-model-form');
if (addModelForm) addModelForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('add-model-err');
  const fd = new FormData(addModelForm);
  const payload = Object.fromEntries(fd.entries());
  const isEdit = editingModelId != null;
  if (!payload.apibase?.trim() || !payload.model?.trim()) {
    if (errEl) { errEl.textContent = t('err.modelRequired'); errEl.hidden = false; }
    return;
  }
  if (!isEdit && !payload.apikey?.trim()) {
    if (errEl) { errEl.textContent = t('err.modelRequired'); errEl.hidden = false; }
    return;
  }
  try {
    const res = isEdit
      ? await bridgeFetch(`/model-profiles/${editingModelId}`, { method: 'PUT', body: payload })
      : await bridgeFetch('/model-profiles', { method: 'POST', body: payload });
    if (res?.ok === false || res?.error) throw new Error(res.error || t('err.modelSave'));
    state.modelProfiles = normalizeProfiles(res.profiles || []);
    const pid = isEdit ? editingModelId : (res.profileId ?? state.modelProfiles.at(-1)?.id ?? 0);
    const p = state.modelProfiles.find(x => (x.id ?? 0) === pid) || state.modelProfiles.at(-1);
    if (p) await selectModel(p.id ?? pid, p.name);
    document.getElementById('add-model-modal').hidden = true;
    addModelForm.reset();
    editingModelId = null;
    if (errEl) errEl.hidden = true;
  } catch (ex) {
    if (errEl) { errEl.textContent = (ex.message || t('err.modelSave')); errEl.hidden = false; }
  }
});

const uploadBtn = chatPage.querySelector('.composer-top .ic-btn');
if (uploadBtn) uploadBtn.addEventListener('click', (e) => { e.preventDefault(); showSystem(t('upload.hint')); });

/* ═══════════════ bridge 事件 ═══════════════ */
window.ga.onBridgeReady(async () => {
  state.bridgeReady = true;
  if (!state.activeId) { refreshStatusLabel(); refreshEmptyState(null); }
  await loadModelProfiles();
  await loadBridgeConfig();
  if (document.querySelector('.page[data-page="channels"].active')) renderChannelList(gaServiceStore.list());
  const sess = activeSess();
  if (sess && sess.bridgeSessionId && !sess.messages.length) pollSession(sess);
});
window.ga.onBridgeNotification((msg) => {
  if (msg && msg.type === 'session-state') {
    for (const sess of state.sessions.values()) {
      if (sess.bridgeSessionId === msg.sessionId) {
        if (msg.status === 'running' || msg.state === 'running') pollSession(sess);
        if (msg.state === 'idle' || msg.status === 'idle') tokPollBridge();
        renderSessionList();
        break;
      }
    }
  }
});
window.ga.onBridgeError((err) => { console.warn('[bridge error]', err); });
window.ga.onBridgeClosed(() => { state.bridgeReady = false; runLabel.textContent = t('status.disconnected'); });

/* ═══════════════ Token 统计页 ═══════════════ */
const tokTbody = document.getElementById('tok-tbody');
const tokPager = document.getElementById('tok-pager');
const tokSince = document.getElementById('tok-since');
const tokUntil = document.getElementById('tok-until');
const tokTotalN = document.getElementById('tok-total-n');
const tokTodayN = document.getElementById('tok-today-n');
const tokCostN = document.getElementById('tok-cost-n');
const TOK_PER_PAGE = 15;
let _tokPage = 0;
const TOK_STORE_KEY = 'ga_token_history';

// Model price table: $/M tokens [input, output]
const MODEL_PRICES = {
  'gpt-5.4':[2.50,15],'gpt-5':[1.25,10],'gpt-5-mini':[0.25,2],'gpt-4o':[2.50,10],'gpt-4o-mini':[0.15,0.60],
  'gpt-4.1':[2,8],'gpt-4.1-mini':[0.40,1.60],'gpt-4.1-nano':[0.10,0.40],'o4-mini':[1.10,4.40],
  'claude-opus-4-7':[5,25],'claude-opus-4-6':[5,25],'claude-sonnet-4-6':[3,15],'claude-sonnet-4-5':[3,15],'claude-haiku-4-5':[1,5],
  'deepseek-v4':[0.14,0.28],'deepseek-v4-pro':[0.55,2.19],'deepseek-chat':[0.14,0.28],'deepseek-reasoner':[0.55,2.19],
  'glm-5.1':[0.50,0.50],'minimax-m2.7':[0.50,0.50],'kimi-for-coding':[0.50,2],
};
const CNY_RATE = 7.2;
function estCost(inp, out, model, cacheRead, cacheCreate) {
  let p = [3,15];
  if (model) { const m = model.toLowerCase().replace(/\[.*\]/,''); p = MODEL_PRICES[m] || Object.entries(MODEL_PRICES).find(([k])=>m.includes(k))?.[1] || p; }
  const isClaudeOrDS = model && /claude|deepseek/i.test(model);
  const cacheReadRate = isClaudeOrDS ? 0.1 : 0.5;
  const cacheWriteRate = isClaudeOrDS ? 1.25 : 1.0;
  const cost = (inp*p[0] + out*p[1] + (cacheRead||0)*p[0]*cacheReadRate + (cacheCreate||0)*p[0]*cacheWriteRate) / 1e6 * CNY_RATE;
  return cost.toFixed(2);
}
function fmtTok(n) { return n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':String(n); }
function fmtTime(ts) { return new Date(ts*1000).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
function modelPriceTip(model) {
  if (!model) return '';
  const m = model.toLowerCase().replace(/\[.*\]/,'');
  const entry = MODEL_PRICES[m] || Object.entries(MODEL_PRICES).find(([k])=>m.includes(k))?.[1];
  const known = !!entry;
  const p = entry || [3,15];
  const isClaudeOrDS = /claude|deepseek/i.test(m);
  const cacheReadRate = isClaudeOrDS ? 0.1 : 0.5;
  const cacheWriteRate = isClaudeOrDS ? 1.25 : 1.0;
  const lines = [];
  if (!known) lines.push(lang === 'zh' ? '⚠ 此模型计费规则尚未明确，按默认估算' : '⚠ Pricing not confirmed, using defaults');
  lines.push((lang === 'zh' ? '输入: $' : 'Input: $') + p[0] + ' /M tokens');
  lines.push((lang === 'zh' ? '输出: $' : 'Output: $') + p[1] + ' /M tokens');
  lines.push((lang === 'zh' ? '缓存写入: $' : 'Cache write: $') + (p[0] * cacheWriteRate).toFixed(2) + ' /M tokens');
  lines.push((lang === 'zh' ? '缓存读取: $' : 'Cache read: $') + (p[0] * cacheReadRate).toFixed(2) + ' /M tokens');
  return lines.join('\n');
}

function tokLoadHistory() { try { return JSON.parse(localStorage.getItem(TOK_STORE_KEY)||'[]'); } catch(_) { return []; } }
function tokSaveHistory(h) { localStorage.setItem(TOK_STORE_KEY, JSON.stringify(h)); }

// Poll bridge and snapshot deltas into localStorage
const TOK_SNAP_KEY = 'ga_token_snap';
let _tokLastSnap = (() => { try { return JSON.parse(localStorage.getItem(TOK_SNAP_KEY)||'{}'); } catch(_) { return {}; } })();
let _tokPolling = false;
async function tokPollBridge() {
  if (_tokPolling) return;
  _tokPolling = true;
  try {
    const data = await bridgeFetch('/token-stats');
    const history = tokLoadHistory();
    for (const r of (data.records||[])) {
      const key = r.thread;
      const prev = _tokLastSnap[key] || {input:0,output:0,cacheCreate:0,cacheRead:0};
      let di = r.input-prev.input, do_ = r.output-prev.output, dc = r.cacheCreate-prev.cacheCreate, dr = r.cacheRead-prev.cacheRead;
      if (di<0||do_<0||dc<0||dr<0) { di = r.input; do_ = r.output; dc = r.cacheCreate; dr = r.cacheRead; }
      if (di>0||do_>0||dc>0||dr>0) {
        const sid = key.replace('GA-','');
        const sess = [...state.sessions.values()].find(s=>s.bridgeSessionId===sid);
        const title = sess?.title||sid;
        history.push({sessionId:sid, title:title, input:di, output:do_, cacheCreate:dc, cacheRead:dr, model:r.model||'', ts:Date.now()/1000});
        if(sess?.title) history.forEach(h=>{if(h.sessionId===sid&&(!h.title||h.title===sid))h.title=sess.title;});
      }
      _tokLastSnap[key] = {input:r.input, output:r.output, cacheCreate:r.cacheCreate, cacheRead:r.cacheRead};
    }
    localStorage.setItem(TOK_SNAP_KEY, JSON.stringify(_tokLastSnap));
    tokSaveHistory(history);
  } catch(_) {}
  _tokPolling = false;
}

function tokGetFiltered() {
  let records = tokLoadHistory();
  const since = tokSince?.value ? new Date(tokSince.value).getTime()/1000 : 0;
  const until = tokUntil?.value ? new Date(tokUntil.value).getTime()/1000 : 0;
  if (since) records = records.filter(r=>r.ts>=since);
  if (until) records = records.filter(r=>r.ts<=until);
  return records;
}

function tokRenderStats(filtered, all) {
  let total=0, cost=0;
  filtered.forEach(r=>{total+=(r.input||0)+(r.output||0); cost+=parseFloat(estCost(r.input||0,r.output||0,r.model,r.cacheRead||0,r.cacheCreate||0));});
  if(tokTotalN) tokTotalN.textContent=fmtTok(total);
  if(tokCostN) tokCostN.textContent='¥ '+cost.toFixed(1);
  const todayStart=new Date(); todayStart.setHours(0,0,0,0); const todayTs=todayStart.getTime()/1000;
  let todayT=0; all.filter(r=>r.ts>=todayTs).forEach(r=>{todayT+=(r.input||0)+(r.output||0);});
  if(tokTodayN) tokTodayN.textContent=fmtTok(todayT);
}

function tokRenderTable(records) {
  if(!tokTbody) return;
  const bySession=new Map();
  for(const r of records){
    const k=r.sessionId||'?';
    let title = r.title||k;
    if(!title||title===k){ const ss=[...state.sessions.values()].find(s=>s.bridgeSessionId===k); if(ss)title=ss.title; }
    if(!bySession.has(k)) bySession.set(k,{title:title,input:0,output:0,cacheCreate:0,cacheRead:0,lastTs:0,prompts:[]});
    const s=bySession.get(k); s.input+=r.input||0; s.output+=r.output||0; s.cacheCreate+=r.cacheCreate||0; s.cacheRead+=r.cacheRead||0;
    if(r.ts>s.lastTs){s.lastTs=r.ts; s.title=r.title||s.title;} s.prompts.push(r);
  }
  tokTbody.innerHTML='';
  if(bySession.size===0){tokTbody.innerHTML=`<tr><td colspan="6" style="color:var(--muted)">${t('tok.noData')}</td></tr>`;if(tokPager)tokPager.innerHTML='';return;}
  const sorted=[...bySession.values()].sort((a,b)=>b.lastTs-a.lastTs);
  const totalPages=Math.ceil(sorted.length/TOK_PER_PAGE);
  if(_tokPage>=totalPages)_tokPage=totalPages-1;
  const pageItems=sorted.slice(_tokPage*TOK_PER_PAGE,(_tokPage+1)*TOK_PER_PAGE);
  for(const s of pageItems){
    let sc=0; s.prompts.forEach(p=>{sc+=parseFloat(estCost(p.input||0,p.output||0,p.model,p.cacheRead||0,p.cacheCreate||0));});
    const tr=document.createElement('tr'); tr.className='tok-row-session';
    tr.innerHTML=`<td>${escapeHtml(s.title)}</td><td>${fmtTok(s.input)}</td><td>${fmtTok(s.output)}</td><td>${fmtTok(s.cacheCreate)}</td><td>${fmtTok(s.cacheRead)}</td><td>¥${sc.toFixed(2)}</td>`;
    tokTbody.appendChild(tr);
    const details=[]; s.prompts.sort((a,b)=>b.ts-a.ts);
    for(const p of s.prompts){
      const dr=document.createElement('tr'); dr.className='tok-detail'; dr.hidden=true;
      const modelHtml = p.model ? ` · <span class="tok-model-tip" data-tip="${escapeHtml(modelPriceTip(p.model))}">${escapeHtml(p.model)}</span>` : '';
      dr.innerHTML=`<td>${fmtTime(p.ts)}${modelHtml}</td><td>${fmtTok(p.input||0)}</td><td>${fmtTok(p.output||0)}</td><td>${fmtTok(p.cacheCreate||0)}</td><td>${fmtTok(p.cacheRead||0)}</td><td>¥${estCost(p.input||0,p.output||0,p.model,p.cacheRead||0,p.cacheCreate||0)}</td>`;
      tokTbody.appendChild(dr); details.push(dr);
    }
    tr.addEventListener('click',()=>{const o=tr.classList.toggle('open');details.forEach(d=>d.hidden=!o);});
  }
  if(tokPager){tokPager.innerHTML='';if(totalPages>1)for(let i=0;i<totalPages;i++){const b=document.createElement('button');b.textContent=i+1;if(i===_tokPage)b.className='active';b.addEventListener('click',()=>{_tokPage=i;tokRenderTable(records);});tokPager.appendChild(b);}}
}

async function loadTokenPage(){await tokPollBridge();const f=tokGetFiltered();const all=tokLoadHistory();tokRenderStats(f,all);tokRenderTable(f);}
if(tokSince)tokSince.addEventListener('change',()=>{_tokPage=0;loadTokenPage();});
if(tokUntil)tokUntil.addEventListener('change',()=>{_tokPage=0;loadTokenPage();});
const tokResetBtn=document.getElementById('tok-reset');
if(tokResetBtn)tokResetBtn.addEventListener('click',()=>{if(tokSince)tokSince.value='';if(tokUntil)tokUntil.value='';_tokPage=0;loadTokenPage();});
nav.addEventListener('click',(e)=>{const item=e.target.closest('.nav-item');if(item&&item.dataset.page==='token')loadTokenPage();if(item&&item.dataset.page==='channels')renderChannelList(gaServiceStore.list());if(item&&item.dataset.page==='status')loadStatusPanel();});

/* ═══════════════ 消息通道（复用 gaServiceStore + WS 同步） ═══════════════ */
const CHAN_ICON = '<svg class="lr-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const CHAN_FILE_LABELS = {
  'qqapp.py': 'ch.qq',
  'wechatapp.py': 'ch.wechat',
  'wecomapp.py': 'ch.wecom',
  'dingtalkapp.py': 'ch.dingtalk',
  'tgapp.py': 'ch.telegram',
  'dcapp.py': 'ch.discord',
  'fsapp.py': 'ch.lark',
};
const chanListEl = document.getElementById('chan-list');
const chanEmptyEl = document.getElementById('chan-empty');
const chanLogModal = document.getElementById('chan-log-modal');
const chanLogPre = document.getElementById('chan-log-pre');
const chanLogTitle = document.getElementById('chan-log-title');
const chanConfigModal = document.getElementById('chan-config-modal');
const chanConfigTitle = document.getElementById('chan-config-title');
const chanConfigEditor = document.getElementById('chan-config-editor');
const chanConfigSave = document.getElementById('chan-config-save');
let _chanLogId = null;
let _chanBusy = false;
let _chanToastTimer = null;

function getToastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    root.className = 'toast-root';
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
  }
  return root;
}

function showChanToast(title, detail, kind) {
  if (!title) return;
  const root = getToastRoot();
  if (_chanToastTimer) clearTimeout(_chanToastTimer);
  root.innerHTML = '';
  const el = document.createElement('div');
  el.className = `toast toast-${kind === 'ok' ? 'ok' : 'err'}`;
  const tEl = document.createElement('span');
  tEl.className = 'toast-title';
  tEl.textContent = title;
  el.appendChild(tEl);
  if (detail) {
    const dEl = document.createElement('span');
    dEl.className = 'toast-detail';
    dEl.textContent = detail;
    el.appendChild(dEl);
  }
  root.appendChild(el);
  const show = () => el.classList.add('show');
  requestAnimationFrame(show);
  setTimeout(show, 16);
  _chanToastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

function channelDisplayName(ch) {
  const file = (ch.name || ch.id || '').split('/').pop();
  const key = CHAN_FILE_LABELS[file];
  return key ? t(key) : (ch.name || ch.id || '');
}
function channelStatusClass(status) {
  if (status === 'running') return 'on';
  if (status === 'error') return 'err';
  return 'off';
}
function channelStatusLabel(status) {
  const map = {
    running: 'st.running', offline: 'st.offline', error: 'st.error',
    starting: 'st.starting', stopping: 'st.stopping',
  };
  return t(map[status] || 'st.offline');
}
function channelErrorMessage(code) {
  const map = { not_configured: 'err.channelNotConfigured' };
  return t(map[code] || code || 'err.channelStart');
}
function channelToastDetail(e) {
  const svc = e.data && e.data.service;
  if (svc && svc.lastError) return svc.lastError;
  const code = e.data && e.data.error;
  return channelErrorMessage(code || e.message);
}
function renderChannelList(channels) {
  if (!chanListEl) return;
  const rows = (channels || []).filter((ch) => (ch.id || '').startsWith('frontends/'));
  chanListEl.innerHTML = '';
  if (chanEmptyEl) chanEmptyEl.hidden = rows.length > 0;
  for (const ch of rows) {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.dataset.channelId = ch.id;
    const stClass = channelStatusClass(ch.status || 'offline');
    const running = !!ch.running;
    row.innerHTML = `
      ${CHAN_ICON}
      <div class="chan-meta">
        <b class="chan-name"></b>
        <span class="kv chan-path"></span>
      </div>
      <span class="lr-st ${stClass} chan-status"></span>
      <span class="grow"></span>
      <button type="button" class="link-btn link sm" data-act="configure"></button>
      <button type="button" class="link-btn link sm" data-act="logs"></button>
      <button type="button" class="sw-mini${running ? ' on' : ''}" data-act="toggle" aria-pressed="${running}"><i></i></button>`;
    row.querySelector('.chan-name').textContent = channelDisplayName(ch);
    row.querySelector('.chan-path').textContent = ch.name || ch.id;
    row.querySelector('.chan-status').textContent = channelStatusLabel(ch.status || 'offline');
    row.querySelector('[data-act="configure"]').textContent = t('act.configure');
    row.querySelector('[data-act="logs"]').textContent = t('act.logs');
    chanListEl.appendChild(row);
  }
}
async function toggleChannel(id, running, toggleEl) {
  if (_chanBusy) return;
  _chanBusy = true;
  if (toggleEl) toggleEl.disabled = true;
  const label = channelDisplayName(gaServiceStore.get(id) || { id });
  try {
    if (running) {
      await window.ga.stopService(id);
      showChanToast(t('sys.channelStopped') + ' · ' + label, '', 'ok');
    } else {
      const res = await window.ga.startService(id);
      if (res && res.service && res.service.status === 'error') {
        throw Object.assign(new Error(res.service.lastError || 'start_failed'), { data: res });
      }
      showChanToast(t('sys.channelStarted') + ' · ' + label, '', 'ok');
    }
  } catch (e) {
    showChanToast(
      (running ? t('err.channelStop') : t('err.channelStart')) + ' · ' + label,
      channelToastDetail(e),
      'err'
    );
  } finally {
    _chanBusy = false;
    if (toggleEl) toggleEl.disabled = false;
  }
}
async function openChannelLogs(id) {
  if (!chanLogModal || !chanLogPre) return;
  _chanLogId = id;
  const ch = gaServiceStore.get(id) || { id };
  const titleName = id === '__bridge__' ? (ch.name || 'bridge') : statusDisplayName(ch);
  if (chanLogTitle) chanLogTitle.textContent = t('modal.channelLogs') + ' · ' + titleName;
  chanLogPre.textContent = t('ch.loading');
  openModal('chan-log-modal');
  try {
    const res = await window.ga.getServiceLogs(id, 200);
    const lines = res.lines || [];
    chanLogPre.textContent = lines.length ? lines.join('\n') : t('ch.logEmpty');
  } catch (e) {
    chanLogPre.textContent = t('err.channelLoad') + ': ' + (e.message || e);
  }
}
async function openChannelMykey(channelId) {
  if (!chanConfigModal || !chanConfigEditor) return;
  const ch = gaServiceStore.get(channelId) || { id: channelId };
  if (chanConfigTitle) {
    chanConfigTitle.textContent = t('modal.mykeyConfig') + (channelId ? ' · ' + channelDisplayName(ch) : '');
  }
  chanConfigEditor.value = t('ch.loading');
  chanConfigEditor.disabled = true;
  if (chanConfigSave) chanConfigSave.disabled = true;
  openModal('chan-config-modal');
  try {
    const res = await window.ga.getMykeyContent();
    chanConfigEditor.value = res.content || '';
  } catch (e) {
    chanConfigEditor.value = t('err.channelLoad') + ': ' + (e.message || e);
  } finally {
    chanConfigEditor.disabled = false;
    if (chanConfigSave) chanConfigSave.disabled = false;
    chanConfigEditor.focus();
  }
}
async function saveChannelMykey() {
  if (!chanConfigEditor || !chanConfigSave) return;
  chanConfigSave.disabled = true;
  try {
    await window.ga.saveMykeyContent(chanConfigEditor.value);
    showChanToast(t('sys.configSaved'), '', 'ok');
    chanConfigModal.hidden = true;
  } catch (e) {
    showChanToast(t('err.channelLoad'), e.message || String(e), 'err');
  } finally {
    chanConfigSave.disabled = false;
  }
}
if (chanConfigSave) {
  chanConfigSave.addEventListener('click', saveChannelMykey);
}

/* ═══════════════ 状态面板（复用 ServiceManager + 启停/日志） ═══════════════ */
const statusListEl = document.getElementById('status-list');

function statusDisplayName(s) {
  if (!s) return '';
  if (s.id === '__bridge__') return s.name || 'bridge';
  if (s.id === 'reflect/scheduler.py') return t('proc.scheduler');
  return channelDisplayName(s);
}
function fmtPid(pid) { return pid ? `PID ${pid}` : '—'; }
function fmtRes(s) {
  const cpu = s.cpuPct != null ? `${s.cpuPct}%` : '—';
  const mem = s.memMb != null ? `${s.memMb}MB` : '—';
  return `${cpu} / ${mem}`;
}

function renderStatusPanel(services) {
  if (!statusListEl) return;
  statusListEl.innerHTML = '';
  for (const s of services || []) {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.dataset.serviceId = s.id;
    const stClass = channelStatusClass(s.status || 'offline');
    const running = !!s.running;
    const managed = s.managed !== false;
    let acts = `<button type="button" class="link-btn link sm" data-act="logs"></button>`;
    if (managed) {
      if (running) acts += `<button type="button" class="link-btn link sm" data-act="restart"></button>`;
      acts += `<button type="button" class="sw-mini${running ? ' on' : ''}" data-act="toggle" aria-pressed="${running}"><i></i></button>`;
    }
    row.innerHTML = `
      <b class="st-name"></b>
      <span class="lr-st ${stClass} st-status"></span>
      <span class="kv st-pid"></span>
      <span class="kv st-res"></span>
      <span class="grow"></span>
      ${acts}`;
    row.querySelector('.st-name').textContent = statusDisplayName(s);
    row.querySelector('.st-status').textContent = channelStatusLabel(s.status || 'offline');
    row.querySelector('.st-pid').textContent = fmtPid(s.pid);
    row.querySelector('.st-res').textContent = fmtRes(s);
    const logBtn = row.querySelector('[data-act="logs"]');
    if (logBtn) logBtn.textContent = t('act.logs');
    const rstBtn = row.querySelector('[data-act="restart"]');
    if (rstBtn) rstBtn.textContent = t('act.restart');
    statusListEl.appendChild(row);
  }
}

async function loadStatusPanel() {
  if (!statusListEl) return;
  const res = await window.ga.getServicePanel();
  renderStatusPanel(res.services || []);
}

async function restartService(id) {
  const label = statusDisplayName(gaServiceStore.get(id) || { id });
  await window.ga.stopService(id);
  const res = await window.ga.startService(id);
  if (res && res.service && res.service.status === 'error') {
    throw Object.assign(new Error(res.service.lastError || 'start_failed'), { data: res });
  }
  showChanToast(t('act.restart') + ' · ' + label, '', 'ok');
}

if (statusListEl) {
  statusListEl.addEventListener('click', async (e) => {
    const row = e.target.closest('.list-row');
    if (!row) return;
    const id = row.dataset.serviceId;
    const actEl = e.target.closest('[data-act]');
    if (!actEl || !id) return;
    const act = actEl.dataset.act;
    if (act === 'logs') {
      openChannelLogs(id);
      return;
    }
    if (act === 'restart') {
      if (_chanBusy) return;
      _chanBusy = true;
      try {
        await restartService(id);
        await loadStatusPanel();
      } catch (err) {
        showChanToast(t('act.restart') + ' · ' + statusDisplayName({ id }), err.message || String(err), 'err');
      } finally {
        _chanBusy = false;
      }
      return;
    }
    if (act === 'toggle') {
      if (actEl.disabled || _chanBusy) return;
      const running = actEl.classList.contains('on');
      await toggleChannel(id, running, actEl);
      if (document.querySelector('.page[data-page="status"].active')) loadStatusPanel();
    }
  });
}

gaServiceStore.onServices((list) => {
  if (document.querySelector('.page[data-page="channels"].active')) renderChannelList(list);
  if (document.querySelector('.page[data-page="status"].active')) loadStatusPanel();
});
if (chanListEl) {
  chanListEl.addEventListener('click', async (e) => {
    const row = e.target.closest('.list-row');
    if (!row) return;
    const id = row.dataset.channelId;
    const actEl = e.target.closest('[data-act]');
    if (!actEl || !id) return;
    const act = actEl.dataset.act;
    if (act === 'logs') {
      openChannelLogs(id);
      return;
    }
    if (act === 'configure') {
      openChannelMykey(id);
      return;
    }
    if (act === 'toggle') {
      if (actEl.disabled || _chanBusy) return;
      const running = actEl.classList.contains('on');
      await toggleChannel(id, running, actEl);
    }
  });
}

/* ═══════════════ 启动 ═══════════════ */
loadSessions();
applyAppearance(appearance, plainUi);
applyTheme(theme);
applyI18n();
updateModelChip();
renderSessionList();
if (state.activeId) setActiveSession(state.activeId);
else refreshEmptyState(null);
runLabel.textContent = t('status.connecting');
window.ga.startBridge && window.ga.startBridge();
