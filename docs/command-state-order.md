# 命令状态与消息顺序修复

## 已确认问题与范围

Jamie 最终确认的本地范围仅为：排序与执行状态解耦、收据传递已有消息位置、有证据的本地副本清理。旧版命令存在 processing=completed 而 state=unknown 的记录，但历史状态自动恢复明确排除；不能通过改成 completed 掩盖排序缺陷。不再新增功能或机制。

基线 `7659d02`，隔离分支 `jamie/command-state-order`。主卡 `t_c056131a`，后端子卡 `t_e5ba7875`。不修改运行主目录、现场数据库、Hermes 核心或其他 profile，不在本次实现中发布。

## 最小实现

- 只回归验证现有原生命令独立收尾路径，不修改历史状态恢复逻辑。旧 unknown 保持不变，不重新执行，不按正文或命令名猜测。
- 收据返回关联用户消息既有的 `ref_seq`，只是暴露稳定位置，不分配或重排历史引用。SDK 和本机发送记录保留该位置。
- 历史与本机副本按精确消息身份合并；检查范围为全部已加载历史，不限当前显示窗口。窗口外消息不再追加到尾部。
- 已确认发送的本机副本按服务端位置插入。尚未查得位置的旧已接收副本留在持久队列等待核对，不作为新消息追加。真正尚未确认的发送仍即时上屏。
- 执行状态只更新标记，不能决定消息位置；本机副本回收依据原文已保存的证据，不把 outcome unknown 当成需要重发。

## 验收要求

1. 新命令完成/失败/取消回调及冷读正确，普通模型/追加不被误判；旧 unknown 不被本次补丁改写。
2. 同一条消息在 queued/running/completed/failed/interrupted/unknown/received 收据状态下具有相同位置和身份。
3. 最近历史窗口、上翻、重开、断线恢复及同文不同 ID 不重复、不重排、不重发。
4. SDK 保留可选位置字段，拒绝无效或变化的引用；本机保存/冷恢复保留位置。
5. 后端、SDK、移动端回归及类型检查真实执行。iPhone 手感、开发入口发布和现场数据恢复另行记录，不以本地测试代替。

## 验证结果

本地实现与主控复验已完成，未发布：

- 后端 P1：228 passed，7 个既有 aiohttp key 建议警告；历史 unknown 不改写、新命令成功/失败/取消回调、收据现有引用及 HTTP/快照一致性通过。
- 客户端 `client:check`：unit 24、reliability 20、SDK 18 均通过，包含 TypeScript 与 SDK 构建。
- 移动端 TypeScript 和 274 项测试通过，iOS/Android Expo export 均成功。
- 覆盖四条旧命令窗口外不追加、任意执行状态稳定身份与位置、同文不同 ID、位置冷恢复、缺证据保留、unknown 不重发及已确认副本清理。
- 父控第一次 P1 复验发现新增测试错误依赖 `snapshot.threads[0]`，改为按话题 ID 查找；随后完整 P1 重跑通过。未因此更改业务逻辑。

证据目录：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/command-state-order/`，最终日志为 `final-p1-rerun.log`、`final-client.log`、`final-mobile.log`，P1 工件为 `final-p1-artifacts/`。较早日志与 `backend-evidence/` 是过程证据，不代表最终范围。

以上为发布前本地验收记录。旧收据仍可能显示 unknown；本次只保证它不改变消息位置，不补造旧执行结果。

## 授权发布与公网验收

Jamie 随后明确要求“发布”。开发版 `e25d81262b3a8bd7b09f8c7bfd953f2c6934624b` 已快进到运行目录，安装必要的 `storage.py` 插件改动，并仅重启开发 Gateway 与 Expo。入口仍为 `exps://agent.tuly.space`；固定 Hermes 核心、Jamie 主 Gateway 的 PID/启动时间及开发配置均未变。

- 公网认证 API、模型配置接口及 WebSocket 连接通过，安装插件源码与发布提交一致。
- iOS/Android manifest 指向的实际 bundle 均包含本次位置字段和校验逻辑，Expo 账号为 `jamsben`。
- 公网实际发送 `/status`、`/version`：均 completed，收据位置分别精确对应本条用户消息；同 ID 重试不重复，重新读取历史一致。
- 发布前 8 条旧 unknown 收据全部保持 unknown；其中 5 条有可核验的既有用户引用，已逐条通过公网读取核对，其余未强行补位置或改写状态。
- 本次验收话题 `th_878d2912253749b1a1ae4f5d` 已归档并回读确认。

发布卡 `t_0402d746`。私有证据在上述目录：`release-before.json`、`release-verification.json`、`live-smoke-state.json`；`rollback/` 保留发布前插件及 metadata 备份，Git 回滚基线 `7659d02`。本次无数据库修复或历史状态恢复。iPhone 实际视觉与操作仍待 Jamie 验收；没有生成独立签名包。
