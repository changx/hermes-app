# 工具调用与中间说明

## 已确认目标

按 Jamie 提供的 Hermes 截图展示公开执行过程：中间说明使用现有 Markdown 正文，工具调用使用紧凑操作行；终端命令在浅底等宽块中展示；之后继续说明或最终回复。保留用户气泡、Agent 无气泡、现有图表和全屏阅读。不显示内部思考、原始工具返回、认证信息或整个参数 JSON。

## 已查明缺口与最小实现

当前插件 projection.visible_text 只保留 user/assistant 非空正文；纯工具调用行被排除，history_page 只输出 text。客户端 validMessage 同样只接收正文。已有 post_tool_call 捕获原始 assistant 行，但纯工具调用行被可见性过滤掉。当前 send 对普通状态消息不落库，不能单靠移动界面还原缺失调用。

复用 SessionDB 原始 assistant 行和现有稳定引用，不新增第二套消息数据库。消息新增可选 tool_calls 字段，结构为 {id, name, label, detail?}[]：id 取原始调用 ID；label 为服务器生成的安全展示摘要，detail 仅必要且经脱敏的命令等说明。text 保持公开正文，工具块按同一 assistant 行的调用次序接在正文后。工具记录不宣称成功/失败；没有确切结果就不画成功标记。旧服务和旧消息缺字段时正常显示正文。

纯工具 assistant 行可保留空 text 但必须有有效调用；hidden、内部维护、压缩载体仍不可见。按正式生命周期 hook 尽早发布已持久的原始行，在调用执行中与完成后不重复；若固定核心不能支持调用开始前持久发布，明确记录时间限制，不修改核心、不伪造实时信息。只读投影的参数使用白名单，未知工具只显示工具名，敏感工具仅显示不带参数的动作；终端命令使用已有安全脱敏能力并测试凭据形态。不回写核心原文。

原始引用已发布即不重排；升级前未捕获的纯工具历史不凭正文猜测插入。保留重连、压缩和分页身份规则。

## 工具调用间距

以 Jamie 提供的 Discord 截图为视觉参照：图标、动作和安全参数排成单行，超出一行尾部省略；只有终端命令另用浅灰等宽块，最多两行省略。skill 与文件读取分别使用 📚/📖。纯工具消息行上下外边距各 2pt，工具组取消上下额外留白，组内调用间距 4pt，标签与命令间距 2pt，命令块上下内边距各 4pt。正文段落、用户气泡、复制/全屏操作、48pt 信息流底部留白和自动跟随规则不变。验证生产组件的纯工具/混合正文/普通代码样式，并在隔离 Expo 发布后核对公网包；真机视觉由使用反馈确认。

主控验证：手机组件及回归测试 **133/133**、TypeScript 与 diff 检查通过。新增断言执行生产组件，覆盖单行参数/两行终端省略、仅终端有代码块、纯工具行间距和普通正文/代码不变。自动化不代替 iPhone 视觉确认；证据位于 `workspace/hermes-app/m1-tool-spacing/`。

## 工具参数摘要补充

Jamie 新增要求：浏览页面显示 URL，尽量显示常用工具实际使用的参数，过长内容截断。随后明确收窄为现有几种工具逐项特定处理，不建立通用参数摘要机制。沿用既有 `label/detail` 字段与紧凑操作行，不新增参数 JSON 面板。

- 仅处理明确工具：网页搜索的 query、网页提取的 urls、浏览导航地址、文件读取的路径/范围、文件搜索的模式/路径、写入/修改的路径、终端安全命令与 skill_view 的名称。未知工具、任意执行代码和并行包装器仍只显示动作/工具名称，不递归展开参数。
- 单值与总摘要均有长度上限，省略处显示 `…`；先进行敏感信息检查及强制脱敏，再截断。URL 不透出用户密码、认证查询值或片段；凭据工具仅展示动作名。
- 浏览脚本只静态提取明确传给导航函数的地址，不执行代码、不显示整段脚本或写入文档正文；无法确定时退回动作名。
- 保留原始调用 ID、公开说明顺序和历史重读一致性。工具返回和内部思考仍不进入记录。
- 验收包含 URL/多个地址、路径/范围、长文本/Unicode、异常参数和敏感信息负例；真实历史 API 读回实际提取 URL。仅更新必要的隔离开发插件，不重启 Expo/Jamie 主实例或改固定核心。

根目录 AGENTS.md 同步编辑被保护文件审批超时阻止，本轮没有写入；以上为本轮已确认的新需求，后续规范同步需获准后进行。

主控复验：完整 P1 **93 passed**，`git diff --check` 通过。定向测试执行真实 SessionDB、正式 hook 与历史/搜索 API 重读；覆盖专用字段映射、敏感 URL、编码路径、Unicode、长值截断和未知工具不展开。单值最多 160 单位（URL 180）、detail 最多 600 UTF-16 单位；网页提取最多展示前 3 个地址，更多以省略号提示。未改移动客户端，因此不重复打包。首次完整测试为 92 passed/1 failed：重启测试在 ready.json 写完前读到空文件；保留失败日志，不修改该测试，本轮再次完整运行通过。证据和回滚材料在 `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/m1-tool-arguments/`；iPhone 实际视觉仍单独确认。

开发发布：`020bfc1` 已更新隔离开发插件，仅重启 hermes-app-dev Gateway。公网历史 API 读回真实 Sensor Tower 话题的 2 条 web_extract 记录均包含 URL，多地址明确省略；原消息 ID、引用顺序、正文及调用 ID 保留，连续重读一致。Expo、Jamie Gateway 的 PID/启动时间与固定核心不变。`release-verification.json` 保存读回证据；旧插件和发布前快照保留用于回滚。无须重新安装手机客户端；此结果验证服务端实际输出，不代替 iPhone 视觉确认。

## 搜索词与自动跟随补充

- 搜索网页操作行显示实际 `query`（例如“搜索网页：Sensor Tower API”），仅白名单提取该字段，不展示参数 JSON 或结果。先强制检查脱敏，敏感或异常内容退回动作名；长查询在既有 label 限额内用省略号明确截断。
- Agent 正文/工具输出更新时，处于底部的读者自动跟随；同高度更新、最近消息窗口滑动也须触发。上翻阅读、补历史不抢位置；键盘运动中的有效更新延后至运动结束。
- 信息流底部使用 48pt 内容留白，顶部保持 12pt；不以 flexGrow 撑满短消息列表。
- 沿用既有开发发布授权，更新必要开发插件和 Expo，不动 Jamie 主实例/固定核心；真机体验单独确认。

实现后主控独立验证：P1 **81 passed**（含搜索词、异常/敏感查询、UTF-16 长度边界和真实 hook/历史重读）；手机 **131/131** 与 TypeScript 通过，iOS/Android Expo 导出均成功；客户端检查 23+17 项通过。搜索词复用现有 label，无协议扩展；带 URL query/userinfo/fragment 的歧义查询保守退回动作名。自动跟随比较最后一条 Agent 公开输出，在提交新列表后调度原生末尾滚动，不再仅依赖高度改变；同身份/同高度/滑动窗口和上翻不跟随均执行生产回调测试。证据在 `workspace/hermes-app/m1-search-query/`；这些验证不等于 iPhone 手感已验收。

开发发布：`0046702` 已更新隔离开发插件与 Expo；公网读回真实 Sensor Tower 查询显示实际搜索词，消息身份/正文保留、重读一致，iOS/Android launchAsset 均包含底部留白更新。Jamie Gateway PID/启动时间与固定核心未变。回滚代码 `9e2669a`，旧插件与发布前快照保留在上述证据目录，`release-verification.json` 为公网读回记录。手机重新加载开发项目获取新客户端；iPhone 滚动手感仍待确认。

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

修正 `bd9a6bb` 已发布到开发插件。新增回归先复现 2 failed/1 passed，修正后 P1 全套 63 passed；最后空白过滤微调后定向 16 passed。首次全测被外层 180 秒超时中断，确认子进程退出后以足够预算重跑，全套用时约 190 秒。真实公网复验记录到公开说明、3 次 web_search、1 次 web_extract 和最终回复；说明与调用在执行中可读，重读内容一致、引用唯一、已有消息 ID 保留。测试话题“搜索过程验收”保留供 Jamie 手机检查。证据、原配置/插件回滚和脚本在 `workspace/hermes-app/m1-search-timeline/`，关键文件 `verified-result.json`、`verified-observations.json`、`p1-tests-final.log`。只重启开发 Gateway；Expo、Jamie Gateway 和固定核心未变化，未重新打包客户端；iPhone 视觉待确认。

已实现；主卡 t_0768069c，插件执行卡 t_651fbe99。Jamie 已明确授权验证后更新隔离 hermes-app-dev 插件/Gateway 与 Expo，不动 Jamie 主实例或固定核心。

- 插件在正式 pre_tool_call 发布已持久化的 assistant 原始行，post_tool_call 保留幂等后备。固定核心真实 GatewayRunner + 合成模型/工具集成测试已证明工具处理器尚未返回时 API 可读到纯工具行；这不是付费模型联调或 iPhone 验收。
- API 历史和搜索返回相同可选 tool_calls 结构；SDK 保留字段并验证边界。手机按正文、调用块、下一条正文的顺序显示，连续 assistant 行不重复显示名字；整条消息全屏阅读也保留其工具记录。
- 命令仅通过保守敏感模式检查及核心强制脱敏后显示；未知工具仅显示名称。并行包装器当前显示“并行执行工具”，不展开原始嵌套参数。最多 128 个展示槽，超出时最后一槽明确说明省略数量。记录表示调用已发出，不表示执行成功。
- 旧历史里从未建立引用的纯工具行不会追溯插入；已发布行身份和顺序不变。没有逐 token 文本流；公开说明随原始 assistant 行持久化和 hook 发布。

主控复验：tests/p1 60 passed；客户端检查与手机 125 项测试、TypeScript 通过；iOS/Android Expo 导出通过。证据：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/m1-tool-timeline/`，其中 `p1-parent/runner-timeline.json` 记录调用中可见和完成后不重复。开发版 `6a2eff6` 已发布，`release-verification.json` 读回公网能力、4 个已有话题保留、双平台新 bundle、插件归档一致和 Jamie/Core 未变。`live-smoke-result.json` 记录真实开发模型终端调用：在收据完成前可见，之后最终回复可见，引用唯一；此次模型未输出调用前说明，不把提示中要求的说明当作实际输出。该测试只创建自己的验收话题，完成后已归档回读。首次公网探针使用 urllib 默认 User-Agent 被入口 403 拒绝；改用已有发布脚本相同 User-Agent 后通过，未更改网络规则。iPhone 实际视觉与手势仍需用户确认。
