import { Button, Toast } from '@douyinfe/semi-ui';
import * as bridge from '../../services/bridge';

export function FeatureSection() {
  const handleImportMykey = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.py,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        await bridge.saveMykeyContent(text);
        Toast.success({ content: 'mykey 导入成功' });
      } catch {
        Toast.error({ content: '导入失败' });
      }
    };
    input.click();
  };

  const handleExportMykey = async () => {
    try {
      const content = await bridge.getMykeyContent();
      try {
        const path = await bridge.tauriInvoke('export_mykey', { content });
        if (path) Toast.success({ content: '已导出' });
      } catch {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mykey.py';
        a.click();
        URL.revokeObjectURL(url);
        Toast.success({ content: '已下载' });
      }
    } catch {
      Toast.error({ content: '导出失败' });
    }
  };

  const handleOpenServices = () => {
    window.dispatchEvent(new CustomEvent('ga:go-page', { detail: { page: 'services' } }));
    window.dispatchEvent(new Event('ga:close-settings'));
  };

  return (
    <div className="ga-set-block">
      <div className="ga-set-sec-t">功能</div>
      <div className="ga-feature-buttons">
        <Button type="tertiary" onClick={handleImportMykey}>
          导入 mykey
        </Button>
        <Button type="tertiary" onClick={handleExportMykey}>
          导出 mykey
        </Button>
        <Button type="tertiary" onClick={handleOpenServices}>
          服务管理
        </Button>
      </div>
    </div>
  );
}
