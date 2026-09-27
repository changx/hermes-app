# M1 消息 Markdown：决策与验收

## 决策

- 用户消息按 CommonMark 和常用 GFM 安全子集渲染：标题 1–6、段落、嵌套强调/加粗/删除线、引用、无序/有序列表及起始编号、任务清单、围栏/缩进代码、分隔线、显式/引用链接、`<https://…>` 自动链接、裸 Web URL、转义与实体、表格（对齐和单元格内行内格式）、图片。流式未闭合围栏保持文字/代码可读。
- 复用 markdown-it 14.3.2 的解析器，保留原文复制和代码原文复制；HTML 不执行，不实现任意 Markdown 插件或附件上传。不是“全部插件语法”。链接仅允许经过验证的 http(s) URL；邮箱自动链接、安全策略之外的协议不打开。
- 图片仅允许通过相同的 http(s) 校验（拒绝 userinfo、空白/控制符等）；以固定占位区域和替代文字展示并挂载原生 Image；加载、失败、不可用都保留固定尺寸，不因异步图像比例改变消息高度；混排图片作为文本片段之间独立视图呈现，不在原生 Text 内嵌 View。显示外部图片会向该站点发起请求。
- 扩展范围：`![替代文字](https://…/clip.mp4)`（支持 mp4/m4v/mov/webm URL 后缀）呈现固定区域的原生视频，点按播放、不自动播放；严格匹配的 `<video src="https://…/clip.mp4" controls></video>` 可当媒体处理，其余 HTML 仍为纯文本。视频和图片 URL 使用同一安全校验。
- `$…$` 行内公式由本地 KaTeX 渲染为段落中的独立短公式区域，保留前后文字和格式（首版不保证与文字同一基线）；每条消息最多挂载三个公式/图表 WebView，超出时保留可读原文以限制内存；`$$…$$` 独立公式由本地打包 KaTeX 渲染；` ```mermaid ` 围栏由本地打包 Mermaid 渲染（securityLevel strict）。仅将对应数学/图表数据注入隔离 WebView 内预置渲染模板，CSP 禁止远程资源、网络连接及站外导航，不开放任意网页或消息桥命令。失败保留源内容。公式/图表占据固定 220 高区域且内部滚动；超限公式/图表回退可滚动原文。不声称支持任意 LaTeX 插件或 Mermaid 自定义外部资源。
- 任务清单只在列表项开头识别，普通段落字面的 `[x]` 不变成控件；勾选框只读，不能改变原始消息。代码和表格在消息宽度内水平滚动；不改时间线、键盘、网络或后端。已有发送中浅灰→确认实色的 240ms 颜色过渡及减少动态效果规则保持不变。

## 手机反馈修正：Mermaid 与消息外层布局

- Jamie 在已发布开发版报告 Mermaid 不显示；之前 Chromium 通过不足以证明 iPhone 正常。本轮检查真实 WebView 包装器、原生加载策略及布局尺寸，只有可复现证据才能作为原因；iPhone 实测仍单列。
- Agent 回复去掉外层气泡、背景和边框，不再限制为 90% 或保留气泡内边距，左右仅保留消息列表的 14 点边距并伸展到可用宽度；用户消息仍沿用原气泡、颜色、对齐和内边距。代码、表格、引用块自身的样式保留。
- 不改通信、键盘、滚动跟随或消息身份。针对生产消息行断言两类样式，公式/图表继续本地执行和导航隔离；手机测试、TS、双端导出和公网新资源检查后直接更新隔离 Expo，不动 Gateway。真实手机显示不以自动测试代验收。
- 已核实 13.16.1 的 `style` 传给内部原生 WebView，包装 View 单独由 `containerStyle` 控制；改为外层明确 100% 宽高、内部 flex 填充。iOS `loadHTMLString` 默认 base 为 `about:blank`，原导航允许值无误。该修正消除尺寸歧义，**尚无 Yoga/WKWebView 真机复现证据证明这就是本次空白根因**。
- 渲染异常或 Mermaid 返回无 SVG 内容时，预置脚本只发固定失败状态，原生组件切换为可选择原文；没有命令桥或凭据传递。避免脚本失败后仅留下空白。
- 主控末轮验证：112/112 手机测试、TypeScript、iOS/Android Expo 导出及 Chromium 9/9 通过；布局回归先失败（Agent 仍 flex-start 气泡）后通过。证据为私有 `markdown-verification/followup-*` 和 `layout-red.log`/`layout-green.log`。Linux WebKit 启动因缺 `libevent-2.1.so.7` 被阻，未声称 WKWebView 或真机通过。
- 已发布候选 `499d14c` 到隔离 Expo：公网 iOS/Android manifest 与实际 bundle 已验证包含 `agentMessage`、`renderWebContainer` 和失败回退；首次重启后探测短暂 502，随后复验通过。两个 Gateway 的 PID/启动时间及开发插件哈希不变，证据 `followup-release-before.json`、`followup-release-verification.json`；回滚基线 `09ddfa2`。Mermaid 手机问题仍待 Jamie 确认，不以该发布关闭真机验收。

## 消息格式一致性与去围框

- Agent 整条消息继续无气泡、背景及外框；移除公式、Mermaid 及其原文回退区域的额外围框，让内容自然放在消息区域。代码块、表格网格和引用线保留各自的语义样式，不作为整条消息外框。
- 用户保留原气泡及背景，正文与 Agent 共用 `MessageContent`，不按角色限制语法。验证用户消息从时间线进入真实解析器和组件，覆盖标题、列表、引用、代码、链接、表格、图片、视频、行内/块级公式与 Mermaid；发送中的颜色规则保持。
- 此轮不新增语法或调整资源上限；113/113 手机测试、TypeScript、iOS/Android Expo 导出通过。生产用户/Agent 时间线到真实解析与组件生成相同渲染树；仅用户外围气泡不同。证据 `markdown-verification/parity-tests.log`、`parity-ts.log`、`parity-export.log`。公网资源核验与 iPhone 实测分开，前一轮 Mermaid 真机待确认仍不冒充已解决。

## 用户消息满宽与纯图表零宽修正

- 用户明确：靠右保留，但不限制为屏幕 90%。用户行以左右 14 点边距形成确定宽度，气泡在行内靠右并使用 100% 可用宽度；颜色/圆角保留，不再让 WebView 的百分比宽度反推自动收缩气泡的固有尺寸。Agent 无框布局保持。
- 已用 Yoga 3.2.1 执行从生产 `ChatTimeline`/`MessageContent` 提取的实际样式，对旧提交 `4e464bd` 与候选作对照。仅含图表的消息，在 320/390/768 宽视口旧版 WebView 均为 0 宽；新实现分别为 264/334/712 宽、220 高。此为真实布局引擎的重现，文本测量为固定样本，不等同 iPhone 截图验收。
- 只读核对开发实例里用户最近一条 Mermaid 消息：围栏格式正确，使用原图表进入生产 HTML 渲染器，Chromium 成功产出 SVG。私有样本不进仓库，未修改消息或后端。包括该样本在内的 10 项浏览器验证通过。
- 手机全测、TS、双平台 Expo 导出通过。证据在私有 `markdown-verification/yoga-production-width.mjs`、`yoga-production-results.json`、`width-tests.log`、`width-ts.log`、`width-export.log` 和 `width-browser/browser-results.json`。手机实际显示待确认；已证实并修正零宽缺陷，不把此前不明根因追溯说成早已确定。

## 验收

1. 用真实解析函数验证上述各类语法，包括转义竖线、空/混排单元格、嵌套列表任务误判、引用/链接安全和不完整输入。
2. 用真实组件和原生 mock 验证表格边界与横向滚动、只读勾选框、图片加载与错误/不安全降级；验证文本与图片混排没有 View-in-Text。
3. 解析/组件测试覆盖视频无自动播放、媒体 URL 安全和图片实际加载，数学/图表安全数据与离线渲染模板；全量手机测试、TypeScript、Expo 依赖检查和 iOS/Android Expo 导出通过；保留日志。没有 iPhone 设备时仅报告静态/模拟回调验证，不宣称真机布局、滚动和网络体验验收。

## 本轮实现与验证（隔离分支）

- 生产解析器与 `MessageContent` 接线：安全图片自动加载并在固定 280×168 框内失败重试；视频同尺寸，点击后才挂载 `expo-video`，系统控制条播放，后台/卸载暂停；display KaTeX 和 Mermaid 分别在隔离 WebView 内渲染。行内 `$…$` 已接入 KaTeX 非 display 模式，放在独立 72 高区域，前后文字和嵌套格式保留；首版不与原生文字同一基线。全消息最多三个 WebView（含列表、表格中的公式），超出保留原文。`$$` 关闭定界符之后的普通文字保留，代码/转义美元符不误判。
- WebView 模板为 UTF-8 HTML；CSP `default-src 'none'`、脚本 nonce、仅 data 字体、禁止网络连接及图片；导航回调仅允许 `about:blank`，禁用文件访问/弹窗/cookie/DOM 存储；手机反馈修正后，`onMessage` 仅接受固定 `render-failed` 状态以切换原文，无命令、导航或认证数据传输。`originWhitelist=['*']` 让全部请求进入拒绝回调：已检查并测试 13.16.1 实际包装器，窄名单反而会先调用外部 `Linking.openURL`。KaTeX `trust:false`、Mermaid strict 配置；公式最多 4096 字符、图表最多 6000 字符及 100 edges，超限、WebView 错误或进程被回收时退回定高可滚动原文。未做 iPhone 上的播放器/长图表滚动验收。
- `apps/mobile` 的 `postinstall` 在干净 `npm ci` 自动生成忽略提交的 `src/markdownRenderer.generated.ts`；用 esbuild 从已安装 Mermaid 模块入口重打包，拒绝预制 `mermaid.min.js`，确保实际离线脚本使用 lockfile 的 lodash-es 4.18.1（原 lockfile 4.17.23 的 HIGH 已消除）。`npm audit` 仍报 10 个既有 moderate，未做广泛依赖升级。
- 阶段验证：子代理 `npm ci` postinstall、TypeScript、105 项测试通过；主控接入行内公式后 106 项测试、TypeScript、双平台 Expo 导出和版本检查通过。实际 Chromium 9 项通过，覆盖独立/行内公式、中文流程图/时序图、无效输入回退、脚本注入、图表链接、公式 trust 边界；没有远程请求。最终导航回归及发布记录见下节，阶段结果不冒充末轮结果。

## 主控最终验证

- 最终手机测试 **107/107**、TypeScript 和 iOS/Android Metro 导出通过；已执行安装包内 WebView 的实际导航包装器，验证所有外部协议既不加载也不唤起其他 App。
- Chromium **9/9**：生产模板+真实打包引擎，含中文流程图、序列图、行内/独立公式、无效输入及注入边界；字体可用、无意外远程请求。Chromium 不是 iPhone WKWebView 真机验收。
- Expo 本地版本映射检查通过（CLI 提示离线模式），npm audit 为 10 moderate、0 high、0 critical；10 项 moderate 与主分支基线一致。
- 证据目录：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/markdown-verification/`，包括 `parent-tests.log`、`parent-ts.log`、`parent-export.log`、`parent-audit.json`、`browser-final/browser-results.json`。
- `AGENTS.md` 本轮追加渲染要求的写入因保护文件审批超时被阻止，未重试，文件未修改；实际范围已记在本文和卡片中。
- 发布已完成：代码提交 `1272ee6`，只更新 Expo 开发入口及前端依赖；公网 iOS/Android manifest 和实际 launchAsset bundle 都返回成功且包含新渲染器，Expo 登录账户校验通过。开发 Gateway、Jamie 主 Gateway 的 PID/启动时间和开发插件哈希发布前后完全一致。证据 `release-before.json`、`release-install.log`、`release-verification.json`；回滚基线 `f6e0132` 保留在 Git。iPhone 播放器、排版和手势体验仍待 Jamie 测试。
