# 历史浏览布局稳定性：本地修改前检查点

Jamie 要求先本地提交并记录版本，再修改。此提交只增加本记录，不修改客户端行为。

- 客户端源码基线：`71ca64f7b339796ccccd3f7525e7e5a15268b26d`。
- 本地工作分支：`jamie/session-history-layout-stability`。
- 修改前运行入口仍为 71ca64f：5 个用户起始阅读段，松手加载，220ms opacity 淡入，FlashList 2.3.2，独立 tail 恢复。
- 不恢复后续 momentum gate 等已回退改动。
- main 上未提交的 `docs/dev-environment.md` 与 `docs/dev-lcm-fix.md` 属于其他任务，没有纳入本检查点。
- 历史原发布/回退已验证 mobile 355/355、TypeScript，两平台公网 bundle 与原版本哈希一致。此处记录既有证据，不冒称本检查点重新完成真机验收。

## 本轮范围与验收

保留 FlashList、分页、消息顺序、稳定 key 和其自身位置保持；改善已加载消息的提前渲染、类型布局预测和高度状态通知。当前回收禁用策略不在第一轮贸然更换，以免图片/视频/附件/entering 状态串到不同消息。

目标：本批内容的可靠最终尺寸进入列表布局，再由 FlashList 统一补偿当前消息的新旧内容坐标差，保持视口相对位置；不能拿旧锚点去抵消用户主动滑动。不要增加业务层 scrollToOffset 补丁或修改 node_modules。

先覆盖不拉取、不 prepend、只来回浏览已加载内容的生命周期与高度不变量；另保留 prepend、键盘、latest-follow 和 5 段分页回归。自动测试中的模拟 native 几何不等同于真机无跳动证明。

本轮仅本地开发和验证，不合入运行目录、不部署或重启服务，除非收到后续授权。
