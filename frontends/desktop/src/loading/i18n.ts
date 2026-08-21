export const isZh = (navigator.language || '').toLowerCase().startsWith('zh');

const messages = {
  starting: isZh ? '正在启动 GenericAgent' : 'Starting GenericAgent',
  resuming: isZh ? '正在恢复 GenericAgent' : 'Resuming GenericAgent',
  preparing: isZh ? '正在准备本地运行环境' : 'Preparing the local runtime',
  preparingDetail: isZh ? '首次启动可能需要几分钟，完成后会自动打开主界面。' : 'The first launch may take a few minutes. The main window will open automatically.',
  stage_validate: isZh ? '检查本地文件' : 'Checking local files',
  stage_python: isZh ? '准备 Python 环境' : 'Preparing Python environment',
  stage_dependencies: isZh ? '安装运行组件' : 'Installing runtime components',
  stage_service: isZh ? '启动后台服务' : 'Starting background service',
  stage_ui: isZh ? '打开主界面' : 'Opening the main window',
  ready: isZh ? '准备完成' : 'Ready',
  readyDetail: isZh ? '正在进入主界面…' : 'Opening the main window…',
  logTitle: isZh ? '启动详情' : 'Startup details',
  stagesLabel: isZh ? '启动阶段' : 'Startup stages',
} as const;

export function t(key: keyof typeof messages): string {
  return messages[key];
}

/** Safe lookup: returns the message if the key exists, otherwise the fallback. */
export function tOr(key: string, fallback: string): string {
  return (messages as Record<string, string>)[key] ?? fallback;
}
