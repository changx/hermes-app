# 手机推送设计

## 1. 状态与范围

本文件记录本次讨论确认的通知规则，并区分技术建议与待决事项。这里只整理设计，不代表已实现、已部署或已通过真机验收。

Jamie 当前尚无 Apple Developer 账号。Apple Developer Program 会员、签名与推送凭据是 iPhone 真机远程推送接入的前置条件，不阻塞文档整理。不得自动注册、购买会员或操作账户。

本方案中的“不做跨端同步”仅指不做跨端通知压制、撤回和清除。聊天同步、任务状态、审批竞态控制与既有共享结果已读功能保持不变。

界面中的 Session 对应稳定 Thread。本文件使用 Session 表达用户正在查看的会话；协议定位使用稳定 Thread ID，不使用会变化的物理 Session ID。

手机首发平台、推送供应商、安装分发和构建方式仍待确认。桌面系统通知接入不属于本文件的首版实施范围。

## 2. 已确认的推送类型

| 事件 | 推送规则 |
| --- | --- |
| 任务完成并产生最终结果 | 发送完成通知 |
| 等待用户审批或回答 | 发送通知，包括用户正在 App 内查看其他 Session 的情况 |
| 任务失败且需要用户处理 | 发送失败通知 |
| 定时任务或主动任务产生结果 | 发送结果通知 |
| 公开过程说明、工具调用、运行指示 | 不发送推送 |
| 压缩、记忆整理等内部维护 | 不发送推送 |

完成必须由明确的完成状态及已保存结果确认。不得以 running=false、连接断开或客户端计时推断完成。失败通知只表达真实影响，不将执行 unknown 伪装成失败或成功。

## 3. 已确认的责任划分

### Hermes App plugin

插件在上述事件点统一创建通知，并发送到对应身份下已授权且启用推送的设备。

插件不判断用户当前查看的 Session、App 前后台状态、其他设备是否正在查看或是否已读。不等待跨端已读确认，不通过用户在线状态压制通知。

插件负责权限校验、设备注册、稳定通知身份、可靠发送、重试及有效期处理。这些是安全和发送正确性，不是展示规则。同一审批状态重复发布，不得不断创建新通知。

新增服务端能力只通过独立 Hermes App plugin 与正式扩展点实现。不修改 Hermes 核心，不 monkey patch，不复制权威聊天正文。

### 手机 App 与操作系统

| 手机状态 | 展示规则 |
| --- | --- |
| App 在前台，目标 Session 当前可见 | 不弹横幅、不响铃；页面呈现真实结果或审批 |
| App 在前台，用户查看其他 Session | 显示可点击的通知横幅，包括审批 |
| App 在前台，用户位于列表、设置等页面 | 显示可点击的通知横幅 |
| App 在后台、锁屏或未运行 | 操作系统依据权限、专注模式等系统设置显示 |

“当前可见”不包括仅保存在内存、保持订阅、被其他页面覆盖或已下载消息的 Session。App 前台状态和当前可见页面必须同时满足。

前台展示由客户端通知处理器决定。处理器读取当前本地页面状态，不等待联网读取才决定横幅。当前 SDK 57 必须显式设置前台通知行为；不得依赖其他 SDK 版本的默认行为。

后台使用操作系统可直接展示的远程通知。不得只发静默事件，再依赖后台 JavaScript 生成本地通知。App 未运行时不能保证先执行客户端展示判断。

多任务并发时，各 Session 独立定位。查看 A 不压制 B 的横幅。进入 B 复用既有页面导航，不销毁 A 的页面现场。

## 4. 不做跨端通知协调

桌面已经查看结果，不阻止后台手机收到通知。一台设备完成审批，不主动撤回另一台设备已收到的通知。

共享已读状态仍可清除目录标志，但不能作为服务端推送发送条件。通知接收和通知点击都不自动标记结果已读。结果实际显示后，沿用既有共享已读确认。

点击旧审批通知时，App 读取服务器最新状态。已处理或过期的审批不得再次执行。首版建议不提供锁屏直接批准或拒绝按钮；这项交互仍待确认。

## 5. 建议的最小数据与流程

本节为实现建议，不是已上线的接口契约。

1. Hermes 保存权威结果、失败状态或待处理交互。
2. 插件根据明确事件创建稳定通知身份。
3. 插件为目标设备保存最小发送任务。
4. 发送组件提交通知并保存供应商响应。
5. 发送组件按供应商要求核对回执，并处理临时失败与失效 token。
6. App 或操作系统展示通知。
7. 用户点击后，App 使用已有配对身份读取目标 Session 的最新内容。

需要解决权威状态保存与通知任务创建之间的崩溃窗口。优先复用已有持久状态与正式回调，增加幂等创建及启动恢复核对。不得假定跨数据库写入天然原子，也不得用恢复通知触发模型重新执行。具体扩展点与恢复策略实施前验证。

只新增必要的设备注册和发送任务元数据。不建立第二套聊天历史库，不引入 Redis 或通用消息队列集群作为前置条件。

建议载荷包含：通知协议版本、事件身份、事件类型、配对连接定位信息、稳定 Thread ID，以及适用时的结果或交互版本。具体字段名实施前确定，不视为现有 API。

设备注册必须关联现有认证身份、应用身份及推送环境。token 更新、退出、设备撤销和供应商返回失效状态都必须更新注册信息。不得在普通日志输出 token。

同一事件对同一设备使用稳定去重身份。供应商或网络确认丢失仍可能造成重复或遗漏提醒，不承诺系统通知恰好一次。前台客户端可按事件身份避免重复横幅；后台不能依赖客户端先去重。

通知应有明确有效期。失效审批停止继续重试，但已经发出的旧通知不承诺能撤回。失败发送只重试通知，不重跑任务。供应商接收成功不是手机收到，更不是用户已读。

## 6. 隐私与点击定位建议

建议默认只显示通用英文提示：

- Hermes / Your task is complete.
- Hermes / Your approval is needed.
- Hermes / Your input is needed.
- Hermes / Your task needs attention.
- Hermes / A new result is available.

不发送聊天正文、附件、文件路径、工具参数或凭据。Channel 与 Session 名称默认不显示。内容预览和名称展示仍待确认。

通知只是提醒，不是权威历史。推送延迟、丢失或权限被拒绝，都不能影响服务器保存结果及 App 恢复历史。

点击定位绑定已有配对连接与稳定 Thread ID。不信任载荷提供的任意服务地址，不自动配对，不更换认证。目标不可用时给出用户可理解的提示，不猜测其他 Session。

## 7. Expo Push Service 与直连 APNs

APNs 是 Apple Push Notification service，是 iPhone 远程推送的系统通道。Expo Push Service 是转发服务，不是绕过 APNs 的另一种手机通知系统。

```text
Expo 路线：Hermes App plugin → Expo Push Service → APNs → iPhone
直连路线：Hermes App plugin → APNs → iPhone
Android 的 Expo 路线：Hermes App plugin → Expo Push Service → FCM → Android
```

| 项目 | Expo Push Service | 直连 APNs |
| --- | --- | --- |
| 接入 | 使用 Expo 统一发送接口与回执 | 自行接入 Apple 接口与错误处理 |
| 平台 | 同一发送入口支持 iOS 与 Android | Apple 平台；Android 另接 FCM |
| 隐私 | Expo 和 Apple 都处理通知载荷 | 不经过 Expo；Apple 仍处理载荷 |
| 控制 | 使用 Expo 提供的能力 | 更直接控制 APNs 能力 |
| 维护 | 减少两平台发送协议适配 | 自行维护 Apple 认证、连接与重试 |
| iPhone 前置条件 | 自己的签名包与 Apple 推送凭据 | 同样需要自己的签名包与 Apple 推送凭据 |
| 依赖 | 多一层供应商与网络依赖 | 没有 Expo 转发层 |

Expo 官方说明其推送发送服务免费。这不意味着 Apple 会员、签名、构建或分发免费。Apple 官方列出的 Developer Program 标准会员费为每年 99 USD，或适用的本地货币价格；实际以注册地区结算为准。

Expo 不保证设备一定收到。增加转发层可能增加延迟或故障点，但当前未实测，不能据此声称直连在本项目一定更快或更可靠。

使用 Expo/React Native 客户端不等于必须使用 Expo Push Service。expo-notifications 可以获取原生设备 token，因此可直接接 APNs/FCM。

EAS 云端构建、EAS 凭据管理与 Expo Push Service 是不同选择。采用推送服务不自动授权云端上传源码、托管凭据或发布商店。

当前建议优先考虑 Expo，以减少首版 iOS/Android 接入工作。如果确定只做 iPhone 或优先减少第三方处理，应重新评估直连 APNs。供应商尚未获最终确认；只保留小型发送组件边界，不提前构建通用推送平台。

## 8. 前置条件与授权

- iPhone 真机远程推送需要可安装包、适用的 Apple Developer Program 会员、签名与推送配置。现有 Expo Go 入口不能替代远程推送验收。
- Jamie 当前尚无 Apple Developer 账号。账号注册和会员购买由 Jamie 决定并在官方界面完成。
- 仍需确认首发平台、供应商、安装分发、构建方式、通知隐私默认值及账户操作授权。
- Apple/EAS 登录、凭据操作、设备登记、源码上传、服务部署及商店发布均需相应授权。
- 不在聊天中发送密码、私钥或 token。缺少账号时可以整理设计和进行获授权的隔离开发，不能宣称真机远程推送已完成。

## 9. 验收条件

1. 每个已确认事件类型能产生真实通知；过程记录与维护状态不产生推送。
2. 前台查看 A 时，A 的通知不弹横幅或响铃；B 的完成与审批通知显示横幅。
3. 列表、设置、后台、锁屏及可支持的冷启动场景能展示和打开正确目标。
4. 点击通知复用稳定 Thread 与配对身份，保留其他存活页面，不串 Session 或服务器。
5. 两台设备不做通知协调；一端查看或处理后，另一端旧通知仍可安全点击。
6. 重复事件和临时发送失败不重复创建逻辑通知，不重新执行任务。
7. 服务重启后可恢复尚未完成的通知发送；状态保存与发送任务创建的崩溃窗口有真实恢复证据。
8. 拒绝权限、失效 token、退出与撤销都不破坏历史恢复，不绕过设备授权。
9. 旧审批通知读取当前状态，不能重新批准已经处理或过期的请求。
10. 通知与普通日志不泄露凭据或敏感正文。

自动测试、供应商回执、真实模型生命周期及物理设备证据分别记录。模拟通知、Expo 导出和回执 ok 不能代替真机锁屏验收。未验证的 OS 行为明确标注，不承诺绕过专注模式或强制退出限制。

## 10. 官方参考

以下页面已在本次设计整理中检索；外部能力以实际接入时的官方文档为准。

- [Expo 推送概览](https://docs.expo.dev/push-notifications/overview/)
- [Expo 推送接入](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo 发送、回执与错误处理](https://docs.expo.dev/push-notifications/sending-notifications/)
- [Expo 前台通知与点击处理](https://docs.expo.dev/push-notifications/receiving-notifications/)
- [Expo Notifications API](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo 服务、隐私与可替换性](https://docs.expo.dev/push-notifications/faq/)
- [Development build 与 Expo Go 限制](https://docs.expo.dev/develop/development-builds/faq/)
- [Apple 通知概览](https://developer.apple.com/notifications/)
- [Apple Developer Program 会员能力与费用](https://developer.apple.com/programs/whats-included/)
- [Apple 会员注册](https://developer.apple.com/help/account/membership/program-enrollment/)

## 11. 相关项目文档

- [需求](requirements.md)
- [架构](architecture.md)
- [共享完成结果与已读](completed-unread-directory.md)
- [存活 Session 页面](live-session-pages.md)
- [Session 链接](session-links.md)
- [P2/P3 推送与签名规划](p2-p3-kanban.md)
