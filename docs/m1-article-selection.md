# 全屏文章系统文字选择

## 已确认需求与依据

全屏正文应支持拖动文字选区、高亮及系统提供的完整编辑菜单，不以自制复制按钮替代。实际 iOS 菜单项目依系统版本、语言和内容变化，不能承诺每台设备必定出现翻译/查询/分享等全部项目。

已检查安装版 RN 的 `React/Fabric/Mounting/ComponentViews/Text/RCTParagraphComponentView.mm`：`selectable` 开启 UIEditMenuInteraction，但 copy: 复制整段 attributedText；并未实现 UITextView/WKWebView 式任意选区。此前 selectable 属性测试不足以证明完整选择能力。

## 最小实现

仅全屏整条消息使用已有 react-native-webview 的本地文章 HTML，让 WKWebView/Android WebView 负责原生文字选择。不设置 menuItems、不禁止菜单、不拦截 selection/contextmenu、不注入复制或剪贴板桥。消息流保持原渲染与双击入口；关闭文章不重挂时间线。

复用 messageMarkdown 的 Block/Inline 解析结果安全序列化，不启用原始 HTML。保留标题、段落、嵌套列表、引用、表格、代码、工具摘要及已有图片/视频/KaTeX/Mermaid；表格横向滚动，图表沿用本地受限渲染和独立查看。引擎/字体本地，nonce CSP，无凭据，无任意脚本/导航/弹窗。源码/图表数量上限及失败原文回退保持。

## 验收

生产组件开关回调与不限制原生菜单；HTML转义/恶意内容/CSP/资源边界；真实浏览器跨段和表格文字选区及本地公式/图表渲染；移动全测、TS、双平台导出、公网包。浏览器选区不等于iPhone系统菜单真机验收。

卡片 t_a2b1a6f5；与输入框收缩 t_a9b19487 同次开发发布。

## 主控复核（候选代码，未发布）

- 主控最终移动端全量 **199/199**、SDK **24+17** 项与 TypeScript 检查通过；覆盖输入框清空回到 42pt、处理中发送与独立停止、文章模式生产回调、补充标记及时持久保存、输入输出顺序与未找到精确历史前保留补充原文。证据在私有工作区 `m1-composer-reset/parent-mobile-final.log`、`parent-client-final.log`。
- Chromium 运行生产 HTML 和真实打包引擎：跨段选区、表格、KaTeX、中文 Mermaid 和块索引展开通过；HTML 注入、图表链接未执行。此检查不证明 iPhone 系统菜单或键盘手感。
- 复核发现文章允许所有 HTTPS 图片时，Mermaid 图片节点能额外请求远程资源；改为 CSP 仅允许正文显式 Markdown 图片/视频地址，图表额外资源请求被拦截并显示原文。真实浏览器回归三例通过，无额外网络请求和未捕获异常。显式媒体若跳转至其他地址，可能受 CSP 限制；不为此放开所有图片来源。
- iOS/Android Expo 导出成功，见 `m1-composer-reset/export.log`；公网发布与 iPhone 真机选区仍待验收，不把浏览器选区或自动化测试当作手机已验收。
