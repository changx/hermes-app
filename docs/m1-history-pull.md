# Session 内容页：下拉加载历史

## 已实现（候选验证记录；后续发布见末节）

- 手机对话滚到当前历史顶部后继续下拉，使用原生 `RefreshControl` 加载更早消息，替代 `View earlier messages` 按钮。
- 沿用现有历史路径：先展开已缓存消息；缓存用尽后通过原 `historyWindow` 游标请求更早一页。不改共享协议、权威历史或服务端。
- 网络分页期间保留原生加载指示；同一次请求未完成时不重复加载。没有更早历史时移除下拉入口，未聚焦或正在定位历史时不执行请求。
- 加载前停止自动跟随最新，保持稳定消息身份和 `maintainVisibleContentPosition`；不添加主动滚动，不改原键盘滚动组件。
- 沿用原有历史请求错误提示与再次下拉重试路径。发送操作的 busy 状态不阻止阅读历史。

## 自动验证

在 `jamie/session-pull-history` 隔离工作树中验证：

- 新增 `history-pull.test.mjs`：原生入口与键盘包装透传、分页进度、重复请求保护、历史耗尽、焦点和历史忙碌保护、读取模式、稳定锚点配置、失败后释放请求锁、App 传递分页 Promise。
- 完整 mobile 测试：309/309 通过。
- mobile TypeScript 检查通过。
- Expo SDK 57 iOS 与 Android 导出通过；导出仅证明 bundle 可构建，不是安装包或真机验收。
- `git diff --check` 通过。

隔离工作树首次检查缺少生成的 Markdown renderer 和共享 client dist；执行既有生成/构建脚本后通过。Metro 不接受指向工作树外的 node_modules 链接，改用现有锁定依赖的工作树内副本后双平台导出通过。未修改依赖或 lockfile。

## 待真机验收

1. 长对话上翻到顶部后下拉，旧消息按原顺序出现，原阅读消息不跳走；重复下拉不重复加载。
2. 短对话、键盘打开/关闭、消息渲染高度变化下，加载旧历史不跳回最新。
3. 慢网/断网期间加载指示与错误提示准确，恢复后再次下拉可用。
4. 历史耗尽后不再请求；加载中滑动返回不触发离开页面的原生滚动。

候选验证时未合入 main、未重启 Expo/Gateway、未更新公网手机调试入口；未修改 Hermes 核心、插件或其他 profile。随后授权发布结果见末节。

参考：React Native [`RefreshControl`](https://reactnative.dev/docs/refreshcontrol)（本次读取）说明顶部下拉触发与受控 `refreshing` 行为。实际依赖源码核对 `KeyboardChatScrollView` 的剩余属性透传；这不替代 iPhone 手势验证。

## 授权发布

Jamie 随后明确要求“提交发布”。客户端提交 `6bf6667` 已快进合入 main，只重启 systemd 用户服务 `hermes-app-expo.service`，测试入口保持 `exps://agent.tuly.space`。

- 发布目录 TypeScript 与完整 mobile 测试再次通过（309/309）。
- 公网 iOS/Android manifest 及其精确 launchAsset 均已下载核验：SDK57、既有 Expo 账号、新的原生下拉刷新入口、受控进度与回调、旧按钮移除。Expo 启动初期出现短暂 502，重试后两平台核验通过。
- 开发 Gateway 与 Jamie 主 Gateway 的 PID、启动时间及 active 状态发布前后完全一致；未更新 Hermes 核心、插件或后端配置。
- 回滚分支 `rollback/session-pull-history-before-6bf6667` 保留基线 `b248409`。
- 证据与核验脚本：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-pull-history/`（`release-tests.log`、平台 manifest/代码片段、`release-verification.json`、服务前后状态）。下载 bundle 在保存哈希和核验片段后清理。

请在 Expo Go 完整 Reload 后测试顶部下拉；真机阅读锚点、键盘与断网体验仍待 Jamie 确认，Kanban `t_f4e52b28` 保持 review。
