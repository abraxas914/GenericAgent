import type { BootstrapFailureCode, BootstrapSnapshot } from '../loading/types';

export type SetupLanguage = 'zh' | 'en';

interface FailureMessage {
  title: string;
  description: string;
}

const FAILURE_MESSAGES: Record<BootstrapFailureCode, Record<SetupLanguage, FailureMessage>> = {
  config_unresolved: {
    zh: { title: '未找到 GenericAgent', description: '选择 GenericAgent 文件夹后重试。' },
    en: { title: 'GenericAgent not found', description: 'Select the GenericAgent folder and retry.' },
  },
  prepare_failed: {
    zh: { title: '运行环境准备失败', description: '本地运行环境未准备完成。请重试；如果问题持续，请检查诊断信息。' },
    en: { title: 'Runtime setup failed', description: 'The local runtime could not be prepared. Retry, then check diagnostics if it continues.' },
  },
  spawn_failed: {
    zh: { title: '后台服务未能启动', description: '请检查 GenericAgent 文件夹和 Python 解释器，然后重试。' },
    en: { title: 'Background service could not start', description: 'Check the GenericAgent folder and Python interpreter, then retry.' },
  },
  port_conflict: {
    zh: { title: '本地连接被占用', description: '另一个程序正在占用 GenericAgent 的本地连接。关闭相关程序后重试。' },
    en: { title: 'Local connection is in use', description: 'Another process is using GenericAgent’s local connection. Close it and retry.' },
  },
  service_timeout: {
    zh: { title: '后台服务启动超时', description: '服务没有在预期时间内就绪。请重试；如果问题持续，请展开诊断信息。' },
    en: { title: 'Background service timed out', description: 'The service did not become ready in time. Retry, then open diagnostics if it continues.' },
  },
  service_exited: {
    zh: { title: '后台服务意外退出', description: '服务启动后立即停止。诊断信息中包含退出状态和最近日志。' },
    en: { title: 'Background service exited', description: 'The service stopped immediately after launch. Diagnostics include its exit status and recent logs.' },
  },
  ui_navigation_failed: {
    zh: { title: '主界面未能打开', description: '后台服务已经就绪，但界面加载失败。请重试启动。' },
    en: { title: 'Main window could not open', description: 'The service is ready, but the interface failed to load. Retry startup.' },
  },
  unknown: {
    zh: { title: 'GenericAgent 未能启动', description: '请重试；如果问题持续，请复制诊断信息进行排查。' },
    en: { title: 'GenericAgent could not start', description: 'Retry. If it continues, copy the diagnostics for troubleshooting.' },
  },
};

const COPY = {
  zh: {
    pageTitle: '修复启动问题',
    intro: '检查下面的位置，然后重试。你的记忆、会话和配置不会受到影响。',
    projectLabel: 'GenericAgent 文件夹',
    projectHint: '选择包含 GenericAgent 的本地文件夹。',
    pythonLabel: 'Python 解释器',
    pythonHint: '通常会自动填写；使用虚拟环境时请选择其中的 Python 程序。',
    retry: '重试启动',
    retrying: '正在重试…',
    diagnostics: '诊断信息',
    copy: '复制诊断信息',
    copied: '已复制，可粘贴给部署智能体排查。',
    selectCopy: '请手动复制已选中的诊断信息。',
    privacy: '诊断信息包含本机路径和错误日志，不包含 API Key、会话或记忆内容。',
  },
  en: {
    pageTitle: 'Fix startup',
    intro: 'Check the locations below, then retry. Your memory, sessions, and settings will not be affected.',
    projectLabel: 'GenericAgent folder',
    projectHint: 'Select the local folder that contains GenericAgent.',
    pythonLabel: 'Python interpreter',
    pythonHint: 'Usually filled automatically. If you use a virtual environment, select its Python executable.',
    retry: 'Retry startup',
    retrying: 'Retrying…',
    diagnostics: 'Diagnostic details',
    copy: 'Copy diagnostics',
    copied: 'Copied. Paste it to your deployment agent for troubleshooting.',
    selectCopy: 'Copy the selected diagnostics manually.',
    privacy: 'Diagnostics contain local paths and error logs. They do not contain API keys, sessions, or memory content.',
  },
} as const;

export function setupLanguage(): SetupLanguage {
  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function setupCopy(language: SetupLanguage) {
  return COPY[language];
}

export function failureMessage(code: BootstrapFailureCode | string | undefined, language: SetupLanguage): FailureMessage {
  const resolvedCode = code && code in FAILURE_MESSAGES ? code as BootstrapFailureCode : 'unknown';
  return FAILURE_MESSAGES[resolvedCode][language];
}

export function diagnosticsText(snapshot: BootstrapSnapshot | null): string {
  const diagnostics = snapshot?.diagnostics;
  const logs = Array.isArray(diagnostics?.recentLogs) ? diagnostics.recentLogs : [];
  let guardReason = '';
  try {
    guardReason = sessionStorage.getItem('ga-setup-fallback-reason') || '';
  } catch (_) {
    guardReason = '';
  }
  return [
    'GenericAgent Desktop startup diagnostics',
    `time: ${new Date().toISOString()}`,
    `setup_guard_reason: ${guardReason}`,
    `build_id: ${diagnostics?.buildId || ''}`,
    `platform: ${diagnostics?.platform || ''}`,
    `mode: ${snapshot?.mode || ''}`,
    `phase: ${snapshot?.phase || ''}`,
    `failure_code: ${snapshot?.failure?.code || ''}`,
    `project_dir: ${diagnostics?.projectDir || ''}`,
    `python_path: ${diagnostics?.pythonPath || ''}`,
    `port_state: ${diagnostics?.portState || 'unknown'}`,
    `bridge_identity: ${diagnostics?.bridgeIdentity || ''}`,
    `error: ${snapshot?.failure?.detail || ''}`,
    'recent_logs:',
    ...logs,
  ].join('\n');
}

export const bootstrapFailureCodes = Object.keys(FAILURE_MESSAGES) as BootstrapFailureCode[];
