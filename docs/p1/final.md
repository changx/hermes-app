# P1 本地交付与主控验收

<!-- status-refresh-2026-10-06 -->
> **历史文档说明（2026-10-06）：** 本文记录 P0/P1 当时的协议与证据。插件源码、`scripts/pack-plugin.sh` 与 `tests/p1` 已移到独立仓库 `/opt/projects/jamie/hermes-app-plugin`；`/v1/events`、`/v1/sync`、`/v1/snapshot` 已删除，当前只使用 `/v1/live`、`/v1/catalogue` 与页面 HTTP 读取，见 [核心数据流](../core-dataflow.md)。

状态：P1 本地插件、共享 TypeScript 协议模块和双端测试客户端已通过主控独立验收。正式桌面/手机 UI、签名安装包、真实设备及生产部署不属于本次交付；进入 P2/P3。

## 交付物

- `plugins/hermes_app/`：正式 platform plugin，独立 HTTP/WS、认证、Channel/Thread、稳定原始历史引用、持久接收/FIFO/同步/已读、审批/澄清/停止/取消、附件、搜索和 cron 投递。
- `packages/client/`：平台无关 TS 客户端；`tests/client/desktop` 和 `tests/client/mobile` 为两种传输目标测试入口。移动网络测试使用 Node WebSocket 替身，Metro 另验证实际 Expo Android JS 依赖图，不能称为手机真机或 APK。
- 可复现插件包：`hermes-app-plugin-0.1.0-62c51298537eeb47647e9963a04309b4eccbaebcffe13c008b93b660313377e1.tar.gz`。
- SHA-256：`62c51298537eeb47647e9963a04309b4eccbaebcffe13c008b93b660313377e1`。
- 当前最终证据：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p1/controller-final-evidence/`；Python 完整历史证据同时保存在该目录的 `python-evidence/`。

## 实际独立运行

在项目根目录执行：

```bash
P1_EVIDENCE_DIR="$TMPDIR/hermes-app-p1-controller-final" \
P105_EVIDENCE_DIR=/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p1/controller-final-evidence \
P105_ARTIFACT_DIR=/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p1/controller-final-evidence/artifacts \
UV_CACHE_DIR="$TMPDIR/uv-p1" \
bash scripts/p1-regression.sh /opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline
```

实际退出 0：

- Python **43 passed in 180.80s**。
- 严格历史 gate：`passed:true`、`failures:[]`。真实 GatewayRunner 的原地/轮转/idle/多工具中途压缩、冷恢复、原文顺序及重复文本独立身份均经过验证。
- TS **17 tests / 17 pass / 0 fail**。
- 解包产物经真实隔离 Gateway 加载、读写、停止及重启；双端真实 HTTP/WS 验证迟到设备发现既有审批、竞争答复一胜一冲突、附件冷加载下载、停止/取消/搜索、断线执行与重启回放。
- 同一个 recurring cron job 两次真实 due fire 的相同正文产生不同引用；重投去重和核心行/插件引用窗口修复有隔离证据。
- Metro Android JS 导出通过（2.73 MB），包含新共享客户端；没有 APK、iOS 或设备验收声明。
- `git diff --check` 通过；固定 Hermes 核心基线未修改。

## 主控发现并修复的边界

历史引用只追加，不重建已发布序号；队列空领取与新发送竞态、压缩复制行后的崩溃恢复、Channel 变更事件及归档重试已分别验收。客户端旧连接延迟关闭不能误关新连接，显式重同步可重新连接。首次连接快照包含既有 pending 交互和 active 收据；附件从权威原始用户行关联，不能要求客户端解析本地路径。快照现在覆盖全部 **32 条 queued/running 合计接收上限**；新增满队列测试先在旧代码复现失败，再通过修复。

Description 只在全新逻辑 Session 初始化时注入一次；续聊、超时/长度/idle 压缩、successor 或冷恢复均不补入。

## 已知限制与运行边界

- 固定验证基线 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`。使用的核心内部读取/中断边界有源码与测试约束，升级 Hermes 后需重新验证；不是对任意版本的兼容承诺。
- 当前仅单 owner、多设备、loopback listener。没有安装到活动 profile、改 Hermes 核心、调用真实付费模型、远端推送或部署。
- cron adapter metadata 只有 job_id，当前以核心执行账本及同一 job 串行投递识别执行；不支持跨后续执行的任意旧投递乱序重放保证。未知外部副作用不能自动重试，不承诺跨崩溃 exactly-once。
- 附件上限、交互快照上限及无效游标均显式拒绝；归档保留原文，未提供破坏性历史删除功能。
- 安装/停用、成套备份与回退见 [packaging.md](packaging.md)。备份必须覆盖停止后的整个 profile 数据集，不能只回滚插件元数据而留下不同代际正文。

下一阶段应实现正式 Electron/React 与 Expo/React Native 界面，并验证键盘、长列表、附件、系统凭据及设备生命周期；APNs/FCM 和签名发布另行授权。
