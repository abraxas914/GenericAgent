import type { BootstrapFailureCode, BootstrapSnapshot } from '../loading/types';

export type SetupLanguage = 'zh' | 'en';

interface FailureMessage {
  title: string;
  description: string;
}

const FAILURE_MESSAGES: Record<BootstrapFailureCode, Record<SetupLanguage, FailureMessage>> = {
  config_unresolved: {
    zh: { title: '未找到应用文件', description: '请选择应用文件夹后继续。' },
    en: { title: 'Application files not found', description: 'Choose the application folder to continue.' },
  },
  prepare_failed: {
    zh: { title: '运行环境尚未准备完成', description: '请检查所选应用文件夹和 Python 环境，然后继续启动。' },
    en: { title: 'Environment setup is incomplete', description: 'Check the application folder and Python environment, then continue startup.' },
  },
  spawn_failed: {
    zh: { title: '本地连接未能启动', description: '请选择可用的应用文件夹和 Python 环境后继续。' },
    en: { title: 'Local connection could not start', description: 'Choose a usable application folder and Python environment to continue.' },
  },
  bridge_shutdown_refused: {
    zh: { title: '本地连接暂时无法安全重启', description: '请等待当前操作完成后重试。' },
    en: { title: 'Local connection cannot restart safely', description: 'Wait for the current operation to finish, then retry.' },
  },
  port_conflict: {
    zh: { title: '本地连接被占用', description: '另一个应用正在使用本地连接。关闭相关应用后继续启动。' },
    en: { title: 'Local connection is in use', description: 'Another app is using the local connection. Close it, then continue startup.' },
  },
  service_timeout: {
    zh: { title: '本地连接启动时间过长', description: '请检查所选位置；诊断信息中包含最近的启动记录。' },
    en: { title: 'Local connection is taking too long', description: 'Check the selected locations. Diagnostics contain the latest startup records.' },
  },
  service_exited: {
    zh: { title: '本地连接意外停止', description: '诊断信息中包含停止状态和最近的启动记录。' },
    en: { title: 'Local connection stopped unexpectedly', description: 'Diagnostics contain the stop status and latest startup records.' },
  },
  ui_navigation_failed: {
    zh: { title: '主界面未能打开', description: '本地连接已经就绪，但界面加载失败。诊断信息中包含详细原因。' },
    en: { title: 'Main window could not open', description: 'The local connection is ready, but the interface failed to load. Diagnostics contain details.' },
  },
  unknown: {
    zh: { title: '启动尚未完成', description: '请检查所选位置；需要协助时可复制诊断信息。' },
    en: { title: 'Startup is not complete', description: 'Check the selected locations. Copy diagnostics if you need support.' },
  },
};

const COPY = {
  zh: {
    pageTitle: '完成启动设置',
    intro: '选择应用运行所需的位置。你的记忆、会话和设置不会受到影响。',
    projectLabel: '应用文件夹',
    projectHint: '选择此前用于运行桌面版的应用文件夹。',
    projectPickerTitle: '选择应用文件夹',
    chooseProject: '选择文件夹',
    changeProject: '重新选择',
    projectEmpty: '尚未选择应用文件夹',
    pythonLabel: 'Python 环境',
    pythonHint: '应用会自动选择可用环境；如有需要，可以重新选择。',
    pythonPickerTitle: '选择 Python 环境',
    choosePython: '选择环境',
    changePython: '重新选择',
    pythonEmpty: '选择应用文件夹后自动识别',
    pickerError: '无法打开或读取所选位置，请查看诊断信息。',
    retry: '继续启动',
    retrying: '正在启动…',
    diagnostics: '诊断信息',
    copy: '复制诊断信息',
    copied: '已复制，可发送给技术支持。',
    selectCopy: '请手动复制已选中的诊断信息。',
    privacy: '诊断信息包含本机路径和错误日志，不包含 API Key、会话或记忆内容。',
    helpFeedback: '帮助与反馈',
    contact: '如果仍无法完成启动，可添加微信联系：',
  },
  en: {
    pageTitle: 'Complete startup setup',
    intro: 'Choose the locations the app needs to run. Your memory, sessions, and settings will not be affected.',
    projectLabel: 'Application folder',
    projectHint: 'Choose the application folder previously used to run the desktop app.',
    projectPickerTitle: 'Choose the application folder',
    chooseProject: 'Choose folder',
    changeProject: 'Choose again',
    projectEmpty: 'No application folder selected',
    pythonLabel: 'Python environment',
    pythonHint: 'The app selects an available environment automatically. You can choose another if needed.',
    pythonPickerTitle: 'Choose a Python environment',
    choosePython: 'Choose environment',
    changePython: 'Choose again',
    pythonEmpty: 'Detected after you choose the application folder',
    pickerError: 'The selected location could not be opened or read. Check diagnostics for details.',
    retry: 'Continue startup',
    retrying: 'Starting…',
    diagnostics: 'Diagnostic details',
    copy: 'Copy diagnostics',
    copied: 'Copied. You can send it to technical support.',
    selectCopy: 'Copy the selected diagnostics manually.',
    privacy: 'Diagnostics contain local paths and error logs. They do not contain API keys, sessions, or memory content.',
    helpFeedback: 'Help & Feedback',
    contact: 'If you still cannot complete startup, contact us on WeChat:',
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
