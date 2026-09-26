# M1 首轮实现与独立验证

## 交付状态

已在隔离集成分支实现频道/话题创建改名、频道说明编辑、消息立即上屏、显式ID确认合并、最新历史页和向前翻页、滚屏跟随/阅读位置、Markdown/复制、任务和审批澄清样式。不是全M1或真机验收通过。

AGENTS.md已更新。Discord频道说明未远端修改，文本见m1-usable-chat.md。

## 主控真实验证

- 完整插件回归48 passed（187.42s）；严格原地/轮转/idle/工具中途压缩历史gate通过。
- 共享客户端21项测试通过；最新窗口、稀疏序号、发送身份和旧版兼容均覆盖。
- 移动端23项测试、TypeScript、Expo依赖检查通过；使用真实MessageContent而非临时stub完成iOS/Android Metro导出。
- 解包插件加载到真实隔离Gateway，通过两种HTTP/WS客户端联调；模型为本地明确标记的合成模型，不冒称此轮真实Codex调用或手机运行。
- 实际API读写后读回：频道名称/说明、话题改名；最新页→older_cursor上一页→client_message_id/receipt_id准确映射；双端审批竞争、附件下载、停止、离线执行与重启历史回放通过。
- 插件制品：hermes-app-plugin-0.1.0-1c726ac8177ee7eadb1ff33e56e91026ef0cbfbcfeeed787be20bc5280b36a40.tar.gz。

证据与制品：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/m1-verification/`。

## 限制与部署门槛

- M1 已获 Jamie 明确授权并更新至隔离开发环境，发布代码 `dde5948`，开发插件与已验证归档一致。仅重启 `hermes-gateway-hermes-app-dev.service` 与 `hermes-app-expo.service`；Jamie 主实例 PID/启动时间未变。入口仍为 `exps://agent.tuly.space`。
- 发布后验证：移动端23项测试及TypeScript通过；本机/公网capabilities启用最新页和身份映射，未认证401，认证WS hello正常，重启前3个话题仍在，最新页/旧页/用户消息收据身份实测通过；公网SDK57 manifest与iOS bundle下载成功。证据 `m1-verification/release-verification.json`；回滚插件和原提交保留在同目录 `rollback-pre-m1/`。本轮发布检查未另发模型请求。
- 当前WS只有持久事件，没有真实token草稿帧。界面提供真实queued/running/final反馈，不能宣称逐字流式已完成。
- 手机滑动惯性、键盘、长代码/图片动态尺寸与多种屏幕实际观感仍需Jamie真机验收，体验卡进入review，不提前关闭。
- Markdown图片和附件目前只显示说明，不具备完整图片上传/预览；归档、复杂搜索、桌面、签名、推送未在本轮实现。
- 安装审计仍有10项moderate告警，没有为消除告警强制升级；SQLite旧运行时风险仍由单独卡跟踪。
- 最新页/发送身份只有新插件capability存在才启用，旧后端用有界兼容路径，不假设接口已经上线。

## 手机复测顺序（M1 开发版已更新）

1. 新建频道/话题，修改频道名称说明和话题名称，重新进入确认保存。
2. 发消息看立即上屏、确认不重复和执行状态；复制普通文字与代码。
3. 回复到达时向上读历史，阅读位置不被拉到底部；点回到最新再跟随。
4. 打开长话题先看到最新页；加载旧历史保持锚点；切走返回恢复位置。
5. 弹起/收起键盘、输入多行、查看长Markdown与代码块，报告跳屏/卡顿的具体动作。

