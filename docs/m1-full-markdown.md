# M1 消息 Markdown：决策与验收

> 当前表格宽度规则已由 Jamie 明确确认：外层视口满宽且不撑宽页面，内部网格至少满宽；列总宽不足时扩展填满，过宽时在表格内部横向滚动，不压缩列宽或强制换行。本文后续相关条目保留为历史记录；现行实现及验证见 [表格容器宽度](markdown-table-width.md)。

## 决策

- 用户消息按 CommonMark 和常用 GFM 安全子集渲染：标题 1–6、段落、嵌套强调/加粗/删除线、引用、无序/有序列表及起始编号、任务清单、围栏/缩进代码、分隔线、显式/引用链接、`<https://…>` 自动链接、裸 Web URL、转义与实体、表格（对齐和单元格内行内格式）、图片。流式未闭合围栏保持文字/代码可读。
- 复用 markdown-it 14.3.2 的解析器，保留原文复制和代码原文复制；HTML 不执行，不实现任意 Markdown 插件或附件上传。不是“全部插件语法”。链接仅允许经过验证的 http(s) URL；邮箱自动链接、安全策略之外的协议不打开。
- 图片仅允许通过相同的 http(s) 校验（拒绝 userinfo、空白/控制符等）；以固定占位区域和替代文字展示并挂载原生 Image；加载、失败、不可用都保留固定尺寸，不因异步图像比例改变消息高度；混排图片作为文本片段之间独立视图呈现，不在原生 Text 内嵌 View。显示外部图片会向该站点发起请求。
- 扩展范围：`![替代文字](https://…/clip.mp4)`（支持 mp4/m4v/mov/webm URL 后缀）呈现固定区域的原生视频，点按播放、不自动播放；严格匹配的 `<video src="https://…/clip.mp4" controls></video>` 可当媒体处理，其余 HTML 仍为纯文本。视频和图片 URL 使用同一安全校验。
- `$…$` 行内公式由本地 KaTeX 渲染为段落中的独立短公式区域，保留前后文字和格式（首版不保证与文字同一基线）；每条消息最多挂载三个公式/图表 WebView，超出时保留可读原文以限制内存；`$$…$$` 独立公式由本地打包 KaTeX 渲染；` ```mermaid ` 围栏由本地打包 Mermaid 渲染（securityLevel strict）。仅将对应数学/图表数据注入隔离 WebView 内预置渲染模板，CSP 禁止远程资源、网络连接及站外导航，不开放任意网页或消息桥命令。失败保留源内容。公式/图表占据固定 220 高区域且内部滚动；超限公式/图表回退可滚动原文。不声称支持任意 LaTeX 插件或 Mermaid 自定义外部资源。
- 任务清单只在列表项开头识别，普通段落字面的 `[x]` 不变成控件；勾选框只读，不能改变原始消息。代码和表格在消息宽度内水平滚动；不改时间线、键盘、网络或后端。已有发送中浅灰→确认实色的 240ms 颜色过渡及减少动态效果规则保持不变。

## 代码底色与等宽字体

- 行内代码底色使用 `#dce5f0`，围栏/缩进代码和工具命令区域使用 `#e8eef6`，提高与白色正文及用户气泡的区分；保留深色代码文字。
- 原生代码文字与公式/图表源码回退在 iOS 使用 Menlo，Android 使用 monospace；全文阅读的 code/pre 与源码回退使用 ui-monospace、Menlo、Consolas、monospace 字体栈。普通引用、列表、表格文字仍使用正文字体。
- 只调整展示样式，不修改源文本、复制、横向滚动、发送状态和字号偏好。全文代码块内不重复套行内底色和内边距。
- 本轮在隔离分支实现；自动验证与 iPhone 真机体验分开，更新运行中的 Expo 需要另行发布授权。
- 发布前验证：277/277 手机测试、TypeScript、iOS/Android Metro JS 导出及 diff 检查通过。新增 iOS/Android 组件断言覆盖行内、单行/多行围栏、缩进代码、命令和源码回退的字体，保留换行的复制及水平滚动；HTML 测试覆盖一致底色和块内行内装饰清除。测试日志与候选导出保存在私有 `workspace/hermes-app/code-typography-verification/`；没有 iPhone 真机视觉验收。
- Jamie 随后授权发布，客户端提交 `45b1ba1` 已快进到运行目录并重启 Expo，测试入口保持 `exps://agent.tuly.space`。公网 iOS/Android manifest 与其实际 bundle 已核验新底色、iOS Menlo / Android monospace 及全文 CSS；Metro 按平台折叠字体分支，验证按最终平台字体断言。重启后首次请求短暂 502，重试恢复；末轮两平台完整通过。两个 Gateway 的 PID/启动时间及已安装开发插件文件哈希不变。证据为同目录 `release-before.json` 与 `release-verification.json`，回滚基线 `96f45d1`；iPhone 实际视觉仍待确认。

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

## 用户消息宽度与纯图表零宽修正

- 最新用户纠正：80% 是上限，不是固定宽。普通文字、标题、引用、列表按内容自适应并靠右，仅设 `maxWidth:80%`；正文容器不再用百分比宽度强行撑满。代码、表格、公式、图表和媒体需要可测量/可滚动视口时才使用80%可用区域。用户行仍保留左右14点边距，颜色/圆角不变，Agent无框满宽保持。
- 本次使用生产样式与解析分类在 Yoga 验证三个视口的短文、长文和图表：短文气泡均收缩到76点（受复制按钮自然宽度约束），长文/图表不超过80%，图表宽度保持非零；旧版短文固定占234/290/592点。115项测试、TS通过，证据 `intrinsic-yoga-results.json`、`intrinsic-tests.log`、`intrinsic-ts.log`。这仍不是手机视觉验收。
- 前一轮满宽候选用 Yoga 3.2.1 执行生产样式对照旧提交 `4e464bd`，复现纯图表 WebView 零宽。最新 80% 版本在 320/390/768 宽视口气泡分别为 234/290/592，WebView 为 206/262/564、220 高，且右边缘贴合可用区域（Yoga 像素取整）。113 项测试、TS、双端导出通过；新证据 `yoga-80-results.json`、`width80-tests.log`、`width80-ts.log`、`width80-export.log`。此为真实布局引擎的重现，文本测量为固定样本，不等同 iPhone 截图验收。
- 只读核对开发实例里用户最近一条 Mermaid 消息：围栏格式正确，使用原图表进入生产 HTML 渲染器，Chromium 成功产出 SVG。私有样本不进仓库，未修改消息或后端。包括该样本在内的 10 项浏览器验证通过。
- 手机全测、TS、双平台 Expo 导出通过。证据在私有 `markdown-verification/yoga-production-width.mjs`、`yoga-production-results.json`、`width-tests.log`、`width-ts.log`、`width-export.log` 和 `width-browser/browser-results.json`。手机实际显示待确认；已证实并修正零宽缺陷，不把此前不明根因追溯说成早已确定。

## 原生空白与表格外框后续修正

- 真机仍反馈 Mermaid 空白，先前 Yoga 修复不足以证明整个原生链路正常。追加独立 Linux WebKit 18.4 测试，以 `about:blank` 内联 HTML 跑包括原消息在内的 10 项，全部通过且 SVG 有可见尺寸；仍非 iOS WKWebView 真机证据。
- 原生固定占位先接收 onLayout 的实际宽高，尺寸大于零后才挂载 WebView，并把数值宽高同时传给包装器及原生视图，避开原生百分比/弹性测量差异。离线页面仅回报 `render-ready` / `render-failed`；渲染确认前显示可读源码，失败继续保留原文，不再用空白代表未知状态。不传正文到外部日志或新服务，不开放桥命令。
- 表格满宽外框移除；只在按内容宽度排列的实际单元格网格保留线条，表格仍可横向滚动。用户气泡右侧80%、Agent无框满宽保持。
- 末轮：114/114 手机测试、TS、双平台导出通过；真实 Chromium 10/10、Linux WebKit 18.4 10/10 通过，后者同时检查固定成功/失败回报以及 SVG 实际尺寸。包括原始用户图表，无站外请求。证据 `blank-tests.log`、`blank-ts.log`、`blank-export.log`、`blank-browser-final/{browser-results,webkit-results}.json`。仍未取得 iPhone 原生执行证据，不宣称真机故障完全解决。

## 混合正文与表格可读性

- 用开发实例原消息只读复现：`先说结论：**中文结论。**所以…` 被 markdown-it 的标点侧翼规则当作文字，`**` 外露。仅为 `**` 增加 CJK 标点边界兼容，继续使用成熟 delimiter 配对及嵌套处理，不全局替换原文、不改代码/转义或关闭HTML安全。
- 最新用户决定：表格不为塞进屏幕而压缩列宽，保留可读列宽及横向滚动；只限制外层视口不让整条消息超屏，不添加满宽外框。移除水平弹性回弹，不在重绘时重置用户水平阅读位置。
- 新增整条 Agent 消息、单个表格、Mermaid 图的全屏查看；Agent 回复双击进入全屏文章阅读模式，正文自然排版并纵向滚动，保留可访问的显式阅读入口。单击、链接/复制操作、文字选择和滑动不误触；复用现有渲染器和原文，不递归叠加弹窗。全屏有明确关闭入口、Android 返回关闭、安全区域留白，关闭不改变聊天阅读位置。
- Mermaid 支持缩放、全屏查看和拖动阅读；继续仅运行本地打包引擎，保留 CSP、URL 拒绝、source 大小限制和失败原文。不把浏览器缩放验证等同于 iPhone 手势验收。
- 将回到最新按钮从正文浮层移到现有输入栏内的紧凑向下按钮，保留辅助阅读标签与原跟随回调，不新增状态工具条，不盖住表格文字。
- 验收覆盖中文标点强调、转义/代码不误识别、正文前后和全部表格行保留、表格不压缩且可横向滚动、全屏打开/关闭与图表缩放，以及回到最新不覆盖正文。用户短文自适应80%上限和Agent无框保持。

### 混合渲染与全屏主控复验

- 修正原消息中文标点边界的加粗后，生产解析保留表格前后正文、三列三行全部内容；表格保持156点列宽并横向滚动，不设置满宽外框。
- Agent 双击普通正文或点击阅读入口打开全屏文章；表格/图表独立全屏共用一个 Modal。打开时暂停原位置 WebView，关闭释放全屏实例，避免重复占用。复制、链接、滑动与取消手势不触发文章双击；保留明确关闭及 Android 返回。Mermaid 全屏使用实际可用高度，支持放大/缩小/重置并允许捏合缩放。
- 主控最终复跑120/120手机测试、TypeScript、iOS/Android Expo导出及diff检查全部通过。生产HTML在Chromium与Linux WebKit分别10/10通过，实际断言SVG放大/缩小/重置尺寸、旋转后可见、成功/失败回报和无远程请求。尚无iPhone真机手势/原生渲染验收，不能据此宣布此前手机空白完全解决。
- 证据：私有 `markdown-verification/fullscreen-parent-tests.log`、`fullscreen-parent-ts.log`、`fullscreen-export.log`、`fullscreen-browser/{chromium,webkit}-fullscreen-results.json`、`visible-original-results.json`。此次发布仅更新隔离Expo，Gateway/插件保持不变；发布结果单独记录。

## Mermaid 全图与持久缩放修正

- 真机反馈：捏合松手后弹回。当前页面只有浏览器 viewport 缩放，图形自身仅按钮修改尺寸；初始比例固定为1，没有按消息区域高度/宽度适配。尚不能仅凭源码确认 iOS 回弹的唯一原生原因。
- 本轮改为图形自身维护比例：首次按可用宽高缩小到全图（不放大小图），为缩放按钮预留位置；双指围绕手势中心修改实际 SVG 尺寸，松手/取消手势不重置比例；单指仍滚动查看放大后的图。按钮与捏合同用一个比例，重置回到适合全图。
- 页面不再叠加浏览器原生页面缩放；视口尺寸变化仅在尚未手动缩放或重置后重新适配，用户已缩放时保留比例。消息流和全屏共用相同行为，不修改时间线、表格或网络逻辑；CSP及固定状态桥保持。
- 验收：生产脚本回归覆盖宽图/高图初始适配、捏合后松手/取消不回弹、第二次手势接续、缩放边界及窗口变化；真实 Chromium/WebKit 验证尺寸与事件路径，全量手机测试/TS/双端导出后发布隔离 Expo。触摸事件自动化与真实 iPhone 手势验收分开。
- 本轮实测：122/122 手机测试、TypeScript、iOS/Android Expo 导出通过；Chromium 9/9（CDP 双指触摸输入）与 Linux WebKit 9/9（DOM 触摸事件）验证生产引擎默认全图、缩放松手后保留、旋转不重置、全屏重置适配及放大后滚动，无站外请求。WebKit 复用既有私有依赖目录，未安装系统包。尚未做真实 iPhone 捏合验收。
- 证据：私有 `markdown-verification/pinch-tests-final.log`、`pinch-ts-final.log`、`pinch-export.log`、`pinch-browser/{chromium,webkit}-pinch-results.json`；发布只更新隔离 Expo，结果记录在 `pinch-release-verification.json`。

## 验收

1. 用真实解析函数验证上述各类语法，包括转义竖线、空/混排单元格、嵌套列表任务误判、引用/链接安全和不完整输入。
2. 用真实组件和原生 mock 验证表格边界与横向滚动、只读勾选框、图片加载与错误/不安全降级；验证文本与图片混排没有 View-in-Text。
3. 解析/组件测试覆盖视频无自动播放、媒体 URL 安全和图片实际加载，数学/图表安全数据与离线渲染模板；全量手机测试、TypeScript、Expo 依赖检查和 iOS/Android Expo 导出通过；保留日志。没有 iPhone 设备时仅报告静态/模拟回调验证，不宣称真机布局、滚动和网络体验验收。

## 本轮实现与验证（隔离分支）

- 生产解析器与 `MessageContent` 接线：安全图片自动加载并在固定 280×168 框内失败重试；视频同尺寸，点击后才挂载 `expo-video`，系统控制条播放，后台/卸载暂停；display KaTeX 和 Mermaid 分别在隔离 WebView 内渲染。行内 `$…$` 已接入 KaTeX 非 display 模式，放在独立 72 高区域，前后文字和嵌套格式保留；首版不与原生文字同一基线。全消息最多三个 WebView（含列表、表格中的公式），超出保留原文。`$$` 关闭定界符之后的普通文字保留，代码/转义美元符不误判。
- WebView 模板为 UTF-8 HTML；CSP `default-src 'none'`、脚本 nonce、仅 data 字体、禁止网络连接及图片；导航回调仅允许 `about:blank`，禁用文件访问/弹窗/cookie/DOM 存储；手机反馈修正后，`onMessage` 仅接受固定 `render-ready` / `render-failed` 状态以切换图表或原文，无命令、导航或认证数据传输。`originWhitelist=['*']` 让全部请求进入拒绝回调：已检查并测试 13.16.1 实际包装器，窄名单反而会先调用外部 `Linking.openURL`。KaTeX `trust:false`、Mermaid strict 配置；公式最多 4096 字符、图表最多 6000 字符及 100 edges，超限、WebView 错误或进程被回收时退回定高可滚动原文。未做 iPhone 上的播放器/长图表滚动验收。
- `apps/mobile` 的 `postinstall` 在干净 `npm ci` 自动生成忽略提交的 `src/markdownRenderer.generated.ts`；用 esbuild 从已安装 Mermaid 模块入口重打包，拒绝预制 `mermaid.min.js`，确保实际离线脚本使用 lockfile 的 lodash-es 4.18.1（原 lockfile 4.17.23 的 HIGH 已消除）。`npm audit` 仍报 10 个既有 moderate，未做广泛依赖升级。
- 阶段验证：子代理 `npm ci` postinstall、TypeScript、105 项测试通过；主控接入行内公式后 106 项测试、TypeScript、双平台 Expo 导出和版本检查通过。实际 Chromium 9 项通过，覆盖独立/行内公式、中文流程图/时序图、无效输入回退、脚本注入、图表链接、公式 trust 边界；没有远程请求。最终导航回归及发布记录见下节，阶段结果不冒充末轮结果。

## 主控最终验证

- 最终手机测试 **107/107**、TypeScript 和 iOS/Android Metro 导出通过；已执行安装包内 WebView 的实际导航包装器，验证所有外部协议既不加载也不唤起其他 App。
- Chromium **9/9**：生产模板+真实打包引擎，含中文流程图、序列图、行内/独立公式、无效输入及注入边界；字体可用、无意外远程请求。Chromium 不是 iPhone WKWebView 真机验收。
- Expo 本地版本映射检查通过（CLI 提示离线模式），npm audit 为 10 moderate、0 high、0 critical；10 项 moderate 与主分支基线一致。
- 证据目录：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/markdown-verification/`，包括 `parent-tests.log`、`parent-ts.log`、`parent-export.log`、`parent-audit.json`、`browser-final/browser-results.json`。
- `AGENTS.md` 本轮追加渲染要求的写入因保护文件审批超时被阻止，未重试，文件未修改；实际范围已记在本文和卡片中。
- 发布已完成：代码提交 `1272ee6`，只更新 Expo 开发入口及前端依赖；公网 iOS/Android manifest 和实际 launchAsset bundle 都返回成功且包含新渲染器，Expo 登录账户校验通过。开发 Gateway、Jamie 主 Gateway 的 PID/启动时间和开发插件哈希发布前后完全一致。证据 `release-before.json`、`release-install.log`、`release-verification.json`；回滚基线 `f6e0132` 保留在 Git。iPhone 播放器、排版和手势体验仍待 Jamie 测试。
