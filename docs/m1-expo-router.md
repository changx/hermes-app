# Expo Router 应用导航

## 决定与范围

Jamie 要求应用导航统一使用 Expo Router。替换原先在 `App.tsx` 中按状态切换页面、用 React Native Modal 展示应用内全屏页的方式。使用 SDK 57 官方匹配的 Expo Router / native Stack，不添加自制页面预览、导航动画或返回手势。

本次仅客户端实现与发布；不更改 Gateway、插件或消息协议。已按 Jamie 后续授权发布到现有 Expo 手机测试入口。

## 路由

- `/`：频道列表。
- `/channels/[channelId]`：频道中的话题列表。
- `/threads/[threadId]`：聊天。
- `/connection`：连接与配对。
- `/settings`：Agent 名称、模型与字体设置。
- `/viewer/[id]`：全文、表格、图表、图片和文本附件查看。

入口为 `expo-router/entry`；根布局为 `apps/mobile/src/app/_layout.tsx`。原生 Stack 管理 push、back、返回取消、页面实例及平台动画。iOS 使用平台默认侧滑返回；Android 使用平台默认返回机制，不自行模拟 iOS 手势。深链以首页为返回锚点。

## 状态与资源

- `AppProvider` 只创建一套当前连接的 SDK/outbox，打开设置或内容查看页不重连。
- 聊天加载、输入和交互属于实际 thread route。隐藏聊天不更新已读位置、不继续页面级历史加载；发送在持久化完成后清理对应输入，即使此时设置页覆盖聊天。
- 文字草稿和滚动位置按 thread 保留于当前连接内存，原生 pop 后重新打开同一 thread 可恢复；切换/忘记连接时清除。未发送附件保持原来的组件生命周期：覆盖设置/查看页不移除聊天；真正离开聊天时终止未完成上传并释放该输入组件拥有的临时文件。
- `ViewerProvider` 只保存私有查看内容和资源清理回调，不管理导航栈、动画或页面副本。URL 仅含随机 ID；消息正文、鉴权 token、下载 URL 和本地文件路径不进入路由参数。查看页退出后释放内容；嵌套打开表格/图表不释放下层全文；连接身份变化清空所有查看内容。
- 全屏查看页打开的图片使用独立的临时文件所有权，避免聊天列表移除原消息行时破坏当前查看内容。
- 字体设置、Markdown/WebView 安全限制、原生照片/文件选择器和播放器自身的原生全屏能力保留。

## 验证

执行共享 client build、移动端全部测试、TypeScript 检查、Expo 依赖兼容检查及 iOS/Android Metro 导出。新增真实 React 生命周期测试覆盖单 SDK/outbox、草稿、隐藏页面已读、发送期间打开设置、查看页嵌套和资源释放（含 StrictMode）。这些测试对原生模块/导航接口使用 mock，不等于原生设备手势验收。

真机验收：频道→话题→聊天返回与取消返回；打开设置/全文后返回聊天保留输入和滚动；全文→表格/图表→返回；图片查看与缩放；键盘打开时返回；Android 系统返回；首次连接及重配对后的导航。

## 本次验证结果

- 移动端测试：251/251 通过，0 failed、0 skipped。
- TypeScript、Expo dependency check、Expo 配置解析与共享 client build 通过。
- iOS/Android Metro JS 导出成功；未构建 APK/IPA。
- 父控审查修正了子页覆盖全文时条件卸载 WebView 的问题；真实 React 回归执行生产 `ExpandedContent`，验证覆盖/返回时保留同一文档实例与模拟阅读位置。
- 视频失焦仅暂停，不因路由覆盖销毁播放器；字体文件保持原样，原生标题也使用字体倍率。
- `AGENTS.md` 的导航段仍保留先前官方 Stack 约定；此次补充当前路由文件位置的编辑因工具审批超时未写入，没有绕过。
- 完整日志：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/expo-router/`。
- 已发布客户端提交 `2c7dce2`。公网 iOS/Android manifest 与各自实际 launchAsset 均下载成功，SDK 57、`transform.routerRoot=src/app` 与新版路由标识已核验；后端和 Jamie 主实例 PID/启动时间未变，原字体文件及入口配置哈希未变。发布回读见 `release-verification.json`。

## 键盘回归反馈

迁移后 Jamie 反馈聊天输入区落入安全区、被键盘遮挡及拖动不能收键盘。已确认聊天路由遗漏其他页面已有的 bottom/left/right SafeAreaView；候选恢复该边界并启用已安装键盘库的 iOS 留白触摸兼容项。后续确认从键盘打开的聊天页返回时，频道列表会截短并留大块空白；候选还为频道、设置、连接表单的避让增加路由焦点与键盘可见状态条件，防止隐藏页面受另一页键盘影响、关闭后残留固定高度。修正与验证单独记录在 [Router 聊天键盘回归](m1-router-keyboard.md)，当前未发布，真机仍待验收。

## 官方依据

- 安装与 SDK 依赖：https://docs.expo.dev/router/installation/
- 原生 Stack 与平台默认行为：https://docs.expo.dev/router/advanced/stack/

本次使用 `expo-router ~57.0.23`、`react-native-screens ~4.26.0`，并固定 `react-dom 19.2.3` 与当前 React 一致，避免 npm 自动选择不兼容的 React DOM peer。具体版本以锁文件为准。
