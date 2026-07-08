# packaging

桌面端发布相关材料。本目录的内容**不会**整体打进发布包——CI
（`.github/workflows/desktop-release-package.yml`）只从这里挑选 `scripts/` 下的
安装/卸载脚本拷进各平台的发布产物，其余文件对构建打包过程是只读参考。

## 目录结构

```
frontends/desktop/packaging/
├── README.md            # 本说明
├── CHECKLIST.md         # 发布前功能测试清单（测试协调用，不参与打包）
├── TODO.md              # 各平台测试分工与计划（测试协调用，不参与打包）
└── scripts/             # ← 唯一被 CI 消费的内容
    ├── windows/
    │   ├── install_windows.ps1     # 环境准备脚本
    │   ├── uninstall.bat           # 卸载入口（向用户确认后调用 ps1）
    │   └── uninstall_windows.ps1
    ├── linux/
    │   ├── install_linux.sh
    │   └── uninstall.sh
    └── macos/
        ├── install_macos.sh
        └── uninstall.command
```

## CI 如何使用这些脚本

`desktop-release-package.yml` 在打各平台 portable 包时，把对应平台的脚本
`cp` 进发布目录（例如 Windows 包里放 `install_windows.ps1` /
`uninstall.bat` / `uninstall_windows.ps1`）。**修改安装/卸载行为只需改
`scripts/` 下的文件，不需要动 workflow。**

> 说明：实际的桌面壳二进制（`GenericAgent.exe` / `.AppImage` / `.app`）由 CI
> 构建生成并发布到 GitHub Release，不在本仓库内提交，也不在本目录占位。

## 自动化测试体系

打包前通过 `npm run test:all` 一键验证。测试分四层：

| 层 | 命令 | 说明 |
|---|---|---|
| Layer 1 | `npm run test` | UI/store/逻辑测试（vitest + happy-dom） |
| Layer 2 | `npm run test:bridge` | Bridge 连接协议、状态机、API 契约 |
| Layer 3 | `npm run test:bundle` | 构建产物完整性（dist 结构、JS bundle 存在性） |
| Layer 4 | `npm run test:packaging` | 打包前置条件（tauri.conf、icons、脚本语法） |

分层跑：

```bash
npm run test              # Layer 1 全部
npm run test:stress       # Layer 1 压力子集
npm run test:bridge       # Layer 2
npm run test:bundle       # Layer 3（需先 npm run build）
npm run test:packaging    # Layer 4
npm run test:all          # Layer 1-3 一键
```
