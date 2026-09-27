# 追加续轮内部记录的展示修复

截图中的“很好”已由 receipt 原文保存；原生 leftover steer 续轮又创建不带 display_kind/platform_message_id 的 user 行，包含 Gateway 来源封装。它是模型上下文中的续轮输入，不应成为第二条用户气泡。

仅在 App 历史与搜索读取时排除可证明的副本：完整来源封装、hermes_app 平台、同一话题/项目、精确 receipt ID、已移交追加、已存在的更早原文展示引用、载荷与保存原文一致。多条合并时每段都必须验证。未匹配或用户主动发送的相似文本照常保留。

不改 Hermes 核心、模型 context、receipt/turn 状态、已有引用或游标；不删除数据库记录，不把来源字段当作授权。保留稀疏分页游标，历史/搜索/冷读使用相同规则。已有客户端内存缓存可能需重开话题或 App 才能丢弃旧副本。

验收：精确ID而非同文去重；普通文本/用户粘贴封装保留；同轮/最终回复阶段多追加，续轮有工具和无工具；前后分页、搜索、重复冷读；真实数据库副本复现，原始模型内容未变。

## 原生追加反馈（用户后续追加范围）

- 在同次追加派发期间，按精确 reply_to 捕获 Gateway 经 adapter.send 发出的模式提示，保存到原 receipt.feedback；不生成助手回复，不混入模型上下文，不据此改变 processing。
- 直接显示原生首段提示，包括 steer、redirect、interrupt、queue，以及子代理/压缩降级排队。省略一次性配置教学段；支持原文中的实际 iteration/当前工具详情，不自行猜模式。
- 保留核心禁用开关与 30 秒 ACK 去抖。原生纯 queue 文本 debounce 路径不发 ACK，App 同样不补造；steer 降级 queue 若核心发出提示则显示。不是每条快速连发都有单独提示。
- feedback 是发送时的接收反馈，独立于当前处理状态；客户端须校验可选非空字符串（最多2000字符）、持久保存、冷恢复并处理同 receipt state 更新及迟到确认。

Jamie 已授权改完发布：通过后更新隔离开发插件、共享SDK与Expo客户端，不动 Jamie 主实例/固定核心/配置。保留回滚，发布读回截图话题的实际公网结果与两端包。真机验收单列。

## 验证结果

- 新增展示回归在旧逻辑上先复现失败；改后单条/多条同文、分页/搜索/冷读、错误身份与用户主动粘贴的类似文本均通过。
- 真实数据库副本对照只隐藏内部 user row 347，原始输入 ref 280 和其他用户消息不变；模型数据库文件哈希保持不变。线上不删记录。
- 后端 P1 179 个唯一测试按批次结果核对全部通过，含真实 GatewayRunner 的工具期追加、最终回复期两条追加、续轮有工具/无工具，以及原生 feedback 和去抖。模型提供方为本地测试替身，非真实上游模型验收。
- 主控重跑 SDK 46 项、移动端 201 项全部通过，两端 TypeScript 与 SDK build 通过。实际 React Native 组件测试验证 feedback 原文换行展示和独立 reaction。
- 证据目录：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/origin-display-fix/`；`backend-verification.json`、`client-verification.json`、`real-copy-verification.json` 及对应日志/JUnit。发布证据另存 `release-verification.json`，尚无 iPhone 真机验收。

