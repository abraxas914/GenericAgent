# Desktop Session-State Review Guide

改动 Desktop 状态前依次确认：

- [ ] 它属于 component、session workspace、session runtime、bridge domain 还是 app preference？
- [ ] 稳定身份是 session、turn、message、segment 还是 attachment ID？
- [ ] 谁是唯一权威写入者？是否制造了 active projection 之外的新镜像？
- [ ] 它需要跨过 render、session switch、Webview reload、app restart 中哪些边界？
- [ ] async 结果如何通过 sessionId + generation/operation ID 防止串写？
- [ ] delete、cancel、disconnect、restart 如何释放 timer/RAF/request/object URL？
- [ ] 若持久化，是否有 partial schema、version、migration、limits 和损坏降级？
- [ ] 是否覆盖 A/B 乱序、A/B/A 切换、删除后晚到、重启恢复测试？

实现细节与错误矩阵见：`../desktop/frontend/session-state.md`。
