# M1 网络可靠性候选版验证

## 结论与范围

代码候选 `baa277d`，分支 `jamie/m1-reliable-integrate`。主控集成并独立执行全部下列检查，通过本地自动化和隔离真实 Gateway 联调。**未部署、未完成iPhone验收、不是首版全量完成。** 运行目录仍为 `/opt/projects/jamie/hermes-app`；保留该目录，不将合入main视为无副作用操作，因为Expo正在从中提供测试包。

本轮实现SDK连接恢复、持久待发/安全重试、前后台及收据补齐，以及初次设备配对。既有身份不因断网要求再次认证；不修改Hermes核心、现有profile凭据或运行服务。

## 主控实际执行结果

- `scripts/p1-regression.sh`，固定核心 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`：退出0。
- Python `tests/p1`：55 passed；7条非失败aiohttp AppKey提示。
- 严格历史生命周期gate：passed；真实隔离Gateway的原地压缩、idle、轮转与竞态回归通过。
- `client:check`：TypeScript/构建通过，21项基础测试、16项可靠性测试通过；故障测试已纳入默认检查命令。
- 手机 `npm test`：52 passed，包括持久顺序、ACK丢失、跨身份、存储失败、Unicode大小、24条容量、终态回收及配对恢复。
- 手机 `npm run check`：通过。
- 手机iOS、Android Metro JS导出：均退出0。导出不是独立签名安装包或真机测试。

## 真实隔离协议联调

执行 `tests/client/real-gateway.mjs`，使用本轮打包后解包插件与实际GatewayRunner、SessionDB和真实HTTP/WS连接；模型为明确标注的本地合成测试服务，不是生产模型调用。移动端存储为执行原生键规则的内存替身，生命周期和网络故障为注入条件，不冒充iPhone系统行为。

新增验证：

1. 管理员CLI `scripts/device-pairing.py` 对测试Gateway签发配对码；手机端真实 `completePairing` 发出兑换，故意丢弃成功响应；随后自动用已保存的候选凭据验证成功，无需重新签发。
2. 初始断网进入SDK自动恢复；真实 `MobileOutbox` 先持久入队，断网期间未发POST。
3. 网络恢复自动发送，故意在服务端接收后丢失ACK；原ID重试后断言仅一条权威用户消息、一条助手回复。
4. 收据终态与历史同步后待发记录回收；重建客户端/存储控制器仍能查询原终态，无新增发送。
5. 原有双客户端、完整Gateway进程重启、离线执行、审批竞态、附件、取消、历史分页及用户身份映射回归继续通过。

证据目录：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/m1-reliability-verification/`。

- `real-gateway.json`：包含 `mobile_recovery` 与 `device_runtime:false`。
- `python-tests.log`、`strict-gate.log`、`client-check.log`、`client-real.log`、`metro-export.log`。
- `artifacts/`：本轮插件归档与校验。
- `mobile-exports/`：本轮原生JS导出保留；不是可安装应用。

## 设备配对运维入口

仅由管理员在已安全提供 `HERMES_APP_TOKEN` 环境变量的会话运行，命令参数不含凭据：

```sh
python3 scripts/device-pairing.py --base https://agent.tuly.space grant
python3 scripts/device-pairing.py --base https://agent.tuly.space devices
```

以上为部署新插件后的运维用法，本轮仅对隔离本地Gateway执行过。签发输出的一次性码由管理员交给设备持有人；普通用户不运行此命令。撤销命令为 `revoke` 加实际设备ID；仅明确授权时执行。

兑换正文含客户端已持久保存的候选设备凭据，不放URL；服务端只保存哈希并原子绑定grant。配对码5分钟有效；同码同候选重试幂等，不延长到期；撤销后不得重放复活。设备认证不随正常断线或服务重启到期。旧开发连接继续兼容，但正常新连接UI不再提供原始令牌输入框。

## 未验证及限制

- 未做iPhone真实Wi-Fi/蜂窝切换、弱网、后台冻结、系统杀进程、Keychain持久化和滚动/键盘验收；R1/R2/R3/R5进入review，R4和网络总卡仍未完成。
- 服务端当前不自动裁剪事件；正常旧游标重启回放已通过。SDK的 `410 cursor_expired` 自动重建只完成故障注入测试，插件尚不产生此响应。畸形/异身份/未来400不能为无感而静默接受。
- 配对码到期前从未成功送达服务器，或设备被主动撤销，不能自动获得授权；这与网络ACK丢失后的自动恢复不同。服务器内部故障不要求用户修令牌。
- 非幂等频道创建、审批、停止等操作不套用无差别自动POST重试。
- 原生JS导出警告提示关闭bytecode仅适合调试；尚未生成独立签名包。
- 原有依赖弃用提示与固定SQLite运行时风险未借此做范围外升级。

## 手机验收步骤（部署候选版后）

- 保留现有连接，断网后连续发送，恢复网络：消息自动发送、顺序保持、无重试决策弹窗。
- 正在发送/执行中分别切后台、杀进程，重新打开：历史和最终状态恢复，不重复执行。
- Wi-Fi与蜂窝切换，空闲连接断开再恢复：界面连接状态准确，阅读位置不被抢走。
- 新设备首次配对后重启、切网：无原始令牌输入；配对响应丢失自动恢复。
- 记录手机系统、Expo版本、代码版本、实际结果；未测项继续保留，不提前关闭首版总卡。
