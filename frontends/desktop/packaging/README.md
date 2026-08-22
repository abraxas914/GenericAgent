# packaging

桌面端发布相关材料。本目录的内容**不会**整体打进发布包——CI
（`.github/workflows/desktop-release-package.yml`）只从这里挑选 `scripts/` 下的
安装/卸载脚本和两个 requirements lock；其余文件对构建打包过程是只读参考。

## 目录结构

```
frontends/desktop/packaging/
├── README.md            # 本说明
├── CHECKLIST.md         # 发布前功能测试清单（测试协调用，不参与打包）
├── TODO.md              # 各平台测试分工与计划（测试协调用，不参与打包）
├── python-runtime-requirements.txt # 三个平台的精确 Python runtime 依赖图
├── dmg-build-requirements.txt      # 仅 CI 使用、带 SHA-256 的 DMG 布局工具
└── scripts/             # 平台安装/卸载脚本
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
`uninstall.bat` / `uninstall_windows.ps1`）。Python wheelhouse 同时带入
`python-runtime-requirements.txt` 的副本，首次离线准备与 macOS 离线修复都必须从该
精确版本清单安装。macOS 当前只发布 DMG；`uninstall.command` 保留为脚本材料，但不再
复制到不会上传的 portable 临时目录。

> 说明：实际的桌面壳二进制（`GenericAgent.exe` / `.AppImage` / `.app`）由 CI
> 构建生成并发布到 GitHub Release，不在本仓库内提交，也不在本目录占位。

## Release 权限与发布流程

```text
desktop-portable-* tag push
  ├─ Windows build (contents:read) ─┐
  ├─ Linux build   (contents:read) ─┼─ Actions artifacts ─┐
  └─ macOS build   (contents:read) ─┘                     │
                                                          ▼
                                      publish-release (contents:write)
                                      精确下载三个 artifact
                                      校验六个文件名/非空/SHA-256
                                      创建不可见 draft 并一次上传
                                      校验远端六个 assets
                                      公开为统一 prerelease
```

三个 build job 的 checkout 均设置 `persist-credentials: false`，不接收写 token，也不调用
GitHub Release API。`publish-release` 显式 `needs` 三个平台，且只在 tag push、三个结果都为
`success` 时运行；它不 checkout、不运行 npm/pip/Cargo 或仓库构建脚本。上传失败时最多留下
不可见 draft，不会向用户暴露半套 Release；发布者也拒绝覆盖同 tag 的既有 Release。

`workflow_dispatch` 只运行所选平台（或 all）的候选 artifact 构建。即使未选择的 jobs 是
`skipped`，发布 job 的事件与三个 `success` 条件也不会成立，因此手工运行不会创建 Release。
应用 metadata 版本仍为 `0.2.0`；workflow 只消费维护者实际 push 的匹配 tag，不创建、移动或
改写既有 tag，也不把 `V2.0.0` 等公开命名强行绑定到应用 metadata。

统一 prerelease 必须精确包含以下六个文件：

- `GenericAgent-Desktop-Windows-Portable.zip`
- `SHA256SUMS-windows.txt`
- `GenericAgent-Desktop-Linux-Portable.tar.gz`
- `SHA256SUMS-linux.txt`
- `GenericAgent-Desktop-macOS-aarch64.dmg`
- `GenericAgent-Desktop-macOS-aarch64.dmg.sha256`

## 固定输入与可复现边界

- npm 使用 `npm ci` 和已提交的 `package-lock.json`；Node 固定为 `22.23.2`。
- Rust toolchain 固定为 `1.95.0`，crate 图由 `Cargo.lock` 固定。
- `actions/checkout`、`setup-node`、`setup-python`、artifact upload/download、Rust toolchain
  action 与 Rust cache action 均固定完整 commit SHA，workflow 行尾保留对应版本/来源注释。
- macOS 的 `actions/setup-python` 固定为 CPython `3.12.10`，仅供构建机安装已 hash-lock 的
  DMG 布局工具；它不会进入产物，也不决定包内 Python runtime 版本。
- Windows 在 Git Bash 下用 `cygpath -u` 把 runner 临时目录转换为绝对 POSIX 路径，并硬断言
  转换工具和结果可用，避免盘符被 tar 误判为远端位置；下载 URL、SHA-256 与包内 runtime 不变。
- python-build-standalone 固定 release `20260814`、CPython `3.12.14` 和明确架构；Windows
  x86_64、Linux x86_64、macOS arm64 三个 tarball 均在解压前校验已记录的 SHA-256。
- Python runtime 的 32 个直接/传递依赖全部在 `python-runtime-requirements.txt` 使用 `==`；
  wheel 下载强制 `--only-binary=:all:`。因此离线准备不需要 `setuptools`/`wheel`，二者不再
  放入 wheelhouse。macOS 的 `ds-store==1.3.3` 与 `mac-alias==2.2.3` 另行使用 wheel hash 锁。
- runner label 使用 `windows-2025`、`ubuntu-24.04`、`macos-15`。GitHub 当前的
  `macos-15` 标准 runner 是 Apple silicon；workflow 仍以 `uname -m == arm64` 硬断言，
  PBS 与最终 DMG 名称也明确为 `aarch64`。

这里不声称 bit-for-bit reproducible，仍有以下明确风险：GitHub runner label 内的 image
revision 会更新；Ubuntu apt 包与 Windows runner 提供的 UCRT SDK 版本未锁；Python runtime
依赖版本虽已固定，但三平台 wheel 文件 hash 尚未完整写入跨平台 lock；Tauri/系统打包工具
也可能写入时间戳或平台元数据。以上变化必须由真包 SHA-256 与 L5 旅程留证，不能把当前约束
描述成完整可复现构建。

## macOS 架构与签名事实

当前 macOS 产物只支持 Apple silicon arm64，文件名为
`GenericAgent-Desktop-macOS-aarch64.dmg`。应用在嵌入 runtime 后只做 ad-hoc signing，且
`codesign --verify --deep --strict` 失败会直接终止构建。当前没有 Apple Developer ID 签名，
也没有 notarization；Release notes 必须保留这一事实，不能描述为已公证或受 Apple 信任。

## 包体精简记录

下列实测基于从 commit `e09643142d445424d1d3cb779245da0e920e2339` 派生的本任务工作树，
在 2026-08-22 以 Node `22.23.2` 执行 `npm ci` + production build，并用 workflow 同等
source excludes 对 runtime/app 源树做 gzip 对比：

| 项目 | 结果 | 性质 |
|---|---:|---|
| 生成的 `frontends/desktop/dist` | 106 files / 4,687,796 bytes | 实测未压缩 payload |
| runtime source gzip（仍含 dist） | 4,410,077 bytes | 实测对照 |
| runtime source gzip（排除 dist） | 2,529,269 bytes | 实测新结果 |
| 单份 runtime source gzip 减少 | 1,880,808 bytes（约 1.79 MiB） | 实测；最终 ZIP/tar.gz/DMG 会因各自压缩器而不同 |

`setuptools-84.0.0` 与 `wheel-0.48.0` 的当前 wheel 合计实测为 851,536 bytes（约
0.81 MiB）；这是对旧浮动解析在测量时点的估算，每个平台最终压缩包的实际差值会不同，不能
当作历史产物精确差值。删除 macOS portable staging 对发布 DMG 的包体差值是 **0**（该目录
从未上传）；CI 峰值磁盘预计减少一份 `.app + runtime` 的重复副本，但未运行完整远端 macOS
job 测量，因此只记录为估算，不给出伪精确数字。

## 自动化测试体系

CI 会先运行零依赖的 `npm run test:ci-contract`，确认 workflow、npm 清单与锁文件、
Rust E2E feature、Tauri 配置、窗口权限、v1 static 边界与 v2 public/dist 边界没有发生
跨文件漂移。P2 使用 L0–L6 分层：

| 层 | 主要入口 | 证明范围 |
|---|---|---|
| L0 合并不变量 | `npm run test:ci-contract` + Git 边界检查 | 无冲突标记、static 零差异、本地资料不入库、workflow 范围、版本一致 |
| L1 单元/契约 | `npm run test`、`pytest frontends/tests`、Rust lib tests | React 状态、Python GA_ROOT/导入/降级、Rust 路径/迁移/回滚 |
| L2 服务集成 | Python bridge integration | 隔离目录中的 HTTP/WS、会话、上传、记忆、模型与 conductor |
| L3 浏览器 E2E | `npm run e2e:browser` | Vite UI + 真实 bridge 的关键用户旅程 |
| L4 原生 E2E | `npm run e2e:desktop` / `e2e:desktop:full` | Tauri IPC、bridge 生命周期、foreign port 与 retry |
| L5 发布包 E2E | `e2e/{windows,linux,macos}/` | 真实 ZIP/AppImage/DMG、首启、重启、移动、文件效果与系统集成 |
| L6 人工/canary | 真机短清单、`npm run e2e:canary` | 原生视觉/Gatekeeper/托盘/文件选择器；真实模型 canary 非阻塞 |

分层跑：

```bash
npm run test:ci-contract # 安装依赖前也可直接运行的契约预检
npm run test              # Layer 1 全部
npm run test:stress       # Layer 1 压力子集
npm run test:bridge       # Layer 2
npm run test:bundle       # Layer 3（需先 npm run build）
npm run test:packaging    # Layer 4
npm run test:all          # Layer 1-3 一键
```

## 发布候选证据

L5 三个平台必须来自同一 commit SHA。每个真包报告记录产物 SHA-256、OS/架构、
bootstrap phase、bridge identity、PID/端口、移动前后路径、截图、脱敏日志和清理结果。
自动旅程通过后仍需完成平台短人工清单，最后由
`e2e/package/verify_candidate_evidence.py` 合成候选证据清单。缺少任一平台、manual item、
macOS `.app` 不可变证明或最终进程清理时，P2 不完成。

真包脚本会临时备份并改写真实的 `~/.ga_desktop_settings.json`，结束时按字节恢复；请只在
专用 OS 测试账号中执行。macOS 失效 override 回退场景可能在 Application Support 创建
正常的版本化可写 runtime，这是产品数据而非 `.app` 内容。
