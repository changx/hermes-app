# 手机开发版：附件与发送恢复联合发布

## 范围与授权

Jamie 要求“发布”，随后明确“要带上刚才修改的所有东西”。本次包含附件候选 793592d 与发送恢复 70cb878，合并提交 c31f168。发布客户端、共享 SDK 及必要开发插件；只重启隔离 hermes-app-dev Gateway 和 Expo。Jamie 主实例、固定 Hermes 核心、入口代理和认证配置保持不变。

交付：多图片/文件选择、图片缩略图与全屏预览、系统粘贴入口、全屏文字系统选择、输入区上方真实 typing 状态和三个缩放点，以及确认后队列推进/清理失败恢复修复。既有工具过程、原生复制、Markdown 和 Mermaid 保持。

## 发布前验证

合并版本：移动测试 164/164、移动 TypeScript、SDK 单元 24 项和可靠性 17 项、P1 122 项全部通过；iOS/Android Expo 导出通过。两项 outbox 缺陷有基线失败/修复通过证据。单纯反复停止发送在基线和候选中均通过，不能宣称已定位 iPhone 本次故障根因。

## 执行与回滚

1. 确认主目录仍为干净 f48e5aa、开发实例没有 queued/running 收据，保存服务身份和两个插件文件的回滚副本。
2. 停止 Expo，快进主目录到已验证联合版本；依锁文件安装手机依赖并构建共享 SDK。
3. 停止隔离开发 Gateway，仅更新 adapter.py 与 storage.py；启动开发 Gateway、Expo。
4. 经公网读取 capabilities、iOS/Android manifest 与实际 JS 包，核对新特性和 outbox 修复代码；验证中文附件上传/下载、纯附件消息权威接收与历史一致性。核对 Jamie PID/启动时间和核心提交未变。
5. 记录发布证据；验收话题归档，保留已提交附件以保证历史引用；清理一次性导出和已合入临时 worktree。

私有发布脚本、备份、验证记录保存在 `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/m1-combined-release/`。回滚基线 f48e5aa 和插件原文件保留；必要时停止两个开发服务，以基线创建独立回滚 checkout、安装其锁定依赖并切换 Expo 工作目录，恢复插件后重启。不得 reset/覆盖发布后新增的用户工作，不得改 Jamie 主实例。

## 发布结果

已发布代码 `f7846e016ce23e0014ec798d0dba6fd64230d4c3`。主目录快进合并后按锁文件安装依赖，重新构建共享 SDK；开发插件两文件与仓库一致，开发 Gateway 和 Expo 已启动。公网 iOS/Android manifest、实际包中的附件/typing/outbox 标记及认证 capabilities 均通过。Jamie 主实例 PID/启动时间与固定核心提交、工作树保持不变。

真实公网验收：中文文件名文本与 PNG 上传成功，下载字节完全一致；纯附件消息被权威接收并 completed，同一消息 ID 重试得到同一收据；历史只有一条对应用户消息，两个附件身份/顺序正确。专用验收话题 `th_992ea85c009b411688ed7114` 已归档并回读确认；已提交的小型测试附件保留以维持历史完整。证据为私有目录内 `release-verification.json`、`smoke-result.json`、`before.json` 与 `rollback/`。

## 未完成的真机验收

Expo Go 普通输入框不支持图片粘贴回调，使用独立系统粘贴按钮；并非输入框长按菜单直接粘贴。图片手势、全屏文本选择、键盘/滚动手感和反复停止后的灰色现象仍需 iPhone 确认。发布通过不等于这些验收通过。
