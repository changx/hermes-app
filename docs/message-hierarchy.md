# 消息信息层级（Discord 截图反馈）

## 已确认方向

- 最终回复首条与上方过程拉开间距，使用轻微暖色底；两端统一表达，不把每次工具包装成同权重卡片。
- 公开说明仍是 Markdown 原文；工具为紧凑“图标 + 动作 + 必要对象”，终端另用浅底等宽块。调用不代表成功。
- 连续过程共用发送者/时间；最终回复、用户、直接回复和系统通知打断分组。身份、正文、顺序不变。
- 手机整体不重做，重点减少长路径参数噪声。随后 Jamie 明确要求两端照搬 Discord 的消息处理规则。

## 候选实现

客户端分支 `jamie/message-hierarchy`；服务端在独立插件基线 `plugin-origin/main` 的隔离分支 `jamie/plugin-message-presentation`，没有把插件复制回客户端仓库，也没有改核心。

### 工具：调用同一核心格式化函数

插件对已有白名单安全参数调用 Discord 共用的 `agent.display.build_tool_preview/get_tool_verb/tool_verb_connector/get_tool_emoji`；工具桥复用 `tools.tool_labels.labels_for_call`。返回可选 `caption`（240 UTF-16 上限）与 `icon`（16 上限），SDK 保留并检查单行控制字符、长度；两端直接使用同一 caption/icon，不各自猜文案。既有安全 `label/detail` 保留给旧客户端与完整阅读。

- 读取：`📖 Reading tenancy.py L150-259`。写入/编辑：Discord 默认 40 字符短预览，明确 `...`。
- 搜索：`🔍 Searching the web for …`，只保留已查证安全的 query，不拼接参数串。网页读取使用核心 📄，技能 📚，文件搜索 🔎，读工具详情 📖。
- 终端：`💻 terminal` 与独立安全命令块；不暴露原始参数 JSON、工具返回、内部思考或凭据。
- 未知/敏感工具继续安全降级，不将任意参数交给通用核心预览器。并行包装器不递归泄露嵌套参数。
- 手机仅缩略文件记录附小型详情入口，复用文章阅读页保留完整安全路径；原生长按选择、正文双击、表格/图表阅读保留。
- 桌面取消 details 卡片，保留默认可见摘要、可滚动的命令全文、工具区域辅助阅读标签。旧服务器缺 caption/icon 时使用已有安全字段的兼容展示。

### 最终回复：明确身份与类型

Discord `send` 使用 `metadata.notify` 表达 final delivery，`reply_to_mode=first` 只给首 chunk 带回复引用；底色是客户端表达，不是 adapter 设置背景。App 保留 SessionDB 权威存储，不复制 Discord 发出的文字作为第二份聊天。

- 插件复用正式 `post_llm_call`：核心 turn finalizer 在工具循环结束后给出显式 `assistant_response`、历史与原始 `_row_id`。只验证该尾部原始 ID 对应的 SessionDB 行、公开输出和已完成的同一 turn 引用；绝不按相同正文搜索匹配，亦不依赖最新 assistant/收据完成猜测。
- 插件仅保存 `final_replies(turn_id, ref_seq)` 类型元数据，追加同 ref 的 version 2 持久消息事件；重复 hook 不重复事件。核心正文不写回，稳定 ID/顺序不改变。
- 旧 Codex 原始行若具有已完成、明确 `assistant/message/final_answer` 或 `final` 类型且公开正文一致，可直接证明 final；analysis、reasoning、未完成、隐藏、工具、混合 commentary/final 或缺类型行不能猜测。冻结原始行同时保留这一展示事实。
- API 输出 `display_kind: final`；历史分页、精确 ref、搜索、断线补齐、重启/冻结读取一致。旧客户端忽略新值正常读正文。
- 两端显式 final 首条恢复发送者/时间，顶部留白 **32px（桌面）/32pt（手机）**，浅底 `#f7f5ef`。中途说明与工具仍紧凑，不增加假“完成”徽章。

## 已执行检查

- 插件 P1 全套 **269 passed**：真实 SessionDB、正式 hook、HTTP 历史/搜索、重复 hook、相同正文不同原始 ID、精确 ref、重启/冻结、原生 Codex phase 与敏感/隐藏负例。
- 桌面 TypeScript/build 与 **72/72** 测试；手机 TypeScript 与 **380/380** 测试；共享 SDK 检查、原有 unit/reliability gate 与 **36/36** 包内测试。
- 最终候选 iOS/Android Expo export 均成功；不是独立安装包。
- 本聊天真实联网搜索已执行；将当前 Thread 实际捕获的 2 条搜索调用与 1 条明确原生 final 原始行只读重放到候选投影，短文案/类型有效，身份和顺序保持。此证据不是候选 Gateway 已部署或新模型端到端验收。
- 先前所有失败日志保留：缺 pytest（改用当前 profile scratch 隔离 uv venv，不安装到核心）、新字段旧断言/重复安全检查、HTTP latest 参数、新 SDK 快照 fixture、桌面工具 type/accessibility fixture。修正后全套通过，不隐藏失败历史。

## 未验收/未发布

没有合入运行 main、安装插件、重启 Gateway/Expo、改生产配置或其他 profile。Mac/iPhone 视觉、键盘、选择与点按待真机验收；候选开发发布后还须真实模型、两端历史/同步与公网精确 bundle 读回。证据：当前 `hermes-app-dev/workspace/hermes-app/message-hierarchy/`。完成本地自动检查不等于已上线或独立安装包交付。
