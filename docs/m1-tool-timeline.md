# 工具调用与中间说明

## 已确认目标

按 Jamie 提供的 Hermes 截图展示公开执行过程：中间说明使用现有 Markdown 正文，工具调用使用紧凑操作行；终端命令在浅底等宽块中展示；之后继续说明或最终回复。保留用户气泡、Agent 无气泡、现有图表和全屏阅读。不显示内部思考、原始工具返回、认证信息或整个参数 JSON。

## 已查明缺口与最小实现

当前插件 projection.visible_text 只保留 user/assistant 非空正文；纯工具调用行被排除，history_page 只输出 text。客户端 validMessage 同样只接收正文。已有 post_tool_call 捕获原始 assistant 行，但纯工具调用行被可见性过滤掉。当前 send 对普通状态消息不落库，不能单靠移动界面还原缺失调用。

复用 SessionDB 原始 assistant 行和现有稳定引用，不新增第二套消息数据库。消息新增可选 tool_calls 字段，结构为 {id, name, label, detail?}[]：id 取原始调用 ID；label 为服务器生成的安全展示摘要，detail 仅必要且经脱敏的命令等说明。text 保持公开正文，工具块按同一 assistant 行的调用次序接在正文后。工具记录不宣称成功/失败；没有确切结果就不画成功标记。旧服务和旧消息缺字段时正常显示正文。

纯工具 assistant 行可保留空 text 但必须有有效调用；hidden、内部维护、压缩载体仍不可见。按正式生命周期 hook 尽早发布已持久的原始行，在调用执行中与完成后不重复；若固定核心不能支持调用开始前持久发布，明确记录时间限制，不修改核心、不伪造实时信息。只读投影的参数使用白名单，未知工具只显示工具名，敏感工具仅显示不带参数的动作；终端命令使用已有安全脱敏能力并测试凭据形态。不回写核心原文。

原始引用已发布即不重排；升级前未捕获的纯工具历史不凭正文猜测插入。保留重连、压缩和分页身份规则。

## 验收

- 文字→多次工具→文字→最终回复按原始顺序呈现；仅工具、混合内容、并行调用、中文与长命令可读。
- 不暴露 reasoning/tool result/认证参数；无效调用安全降级。
- API、SDK、时间线及生产组件均有实际执行测试；重复 hook/分页/重连/压缩无丢失和重复，旧协议兼容。
- 现有 Markdown、最大 80% 用户气泡、滚动与网络测试保持通过；TypeScript 及双平台导出通过。
- 自动化与 iPhone 真机验收分开。客户端延续隔离开发发布授权；插件更新需要明确开发后端部署授权，不动 Jamie 主实例或固定核心。

## 进展

### 搜索与公开说明修正

真实开发查询复现两个独立缺口：开发 profile 自动选择 `openai-native`，Codex transport 将普通 `web_search` 替换为服务端内置工具；固定核心未将 `web_search_call` 保存为普通调用，所以不能从空 `tool_calls` 推断没有搜索。另一次真实查询确实输出了公开说明，但它保存在 `codex_message_items` 的 `assistant/message/commentary/output_text` 中，当前投影只读取 `content` 而丢失说明。

修正范围：开发配置显式选择普通 Exa 匿名搜索/提取（内置免费后端可回退）；不复制其他 profile 密钥、不修改核心。开发 `SOUL.md` 要求实际查证和简短公开进展。插件只读取已完成、明确标为 `commentary` 的 assistant message 文本，保留现有核心可见性过滤；不读取 `analysis`、reasoning 或其他工具结果。普通正文和 final_answer 不重复拼接。

验收：真实 SessionDB + 正式 pre_tool_call 在执行前输出公开说明与调用，历史/搜索/重读一致且不重复；隐藏/压缩/错误结构/analysis 不泄露。开发实例真实联网查询显示说明→搜索/提取→最终答案，并验证无需手机重装；iPhone 视觉仍单独验收。

已实现；主卡 t_0768069c，插件执行卡 t_651fbe99。Jamie 已明确授权验证后更新隔离 hermes-app-dev 插件/Gateway 与 Expo，不动 Jamie 主实例或固定核心。

- 插件在正式 pre_tool_call 发布已持久化的 assistant 原始行，post_tool_call 保留幂等后备。固定核心真实 GatewayRunner + 合成模型/工具集成测试已证明工具处理器尚未返回时 API 可读到纯工具行；这不是付费模型联调或 iPhone 验收。
- API 历史和搜索返回相同可选 tool_calls 结构；SDK 保留字段并验证边界。手机按正文、调用块、下一条正文的顺序显示，连续 assistant 行不重复显示名字；整条消息全屏阅读也保留其工具记录。
- 命令仅通过保守敏感模式检查及核心强制脱敏后显示；未知工具仅显示名称。并行包装器当前显示“并行执行工具”，不展开原始嵌套参数。最多 128 个展示槽，超出时最后一槽明确说明省略数量。记录表示调用已发出，不表示执行成功。
- 旧历史里从未建立引用的纯工具行不会追溯插入；已发布行身份和顺序不变。没有逐 token 文本流；公开说明随原始 assistant 行持久化和 hook 发布。

主控复验：tests/p1 60 passed；客户端检查与手机 125 项测试、TypeScript 通过；iOS/Android Expo 导出通过。证据：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/m1-tool-timeline/`，其中 `p1-parent/runner-timeline.json` 记录调用中可见和完成后不重复。开发版 `6a2eff6` 已发布，`release-verification.json` 读回公网能力、4 个已有话题保留、双平台新 bundle、插件归档一致和 Jamie/Core 未变。`live-smoke-result.json` 记录真实开发模型终端调用：在收据完成前可见，之后最终回复可见，引用唯一；此次模型未输出调用前说明，不把提示中要求的说明当作实际输出。该测试只创建自己的验收话题，完成后已归档回读。首次公网探针使用 urllib 默认 User-Agent 被入口 403 拒绝；改用已有发布脚本相同 User-Agent 后通过，未更改网络规则。iPhone 实际视觉与手势仍需用户确认。
