# 手机页面切换动画与返回手势

## 范围

Jamie 要求为 App 增加页面切换动画与手势支持。本轮在现有 Expo 手机界面内实现，不引入新的导航框架，不改 Hermes 核心、服务端或通信协议。

- 频道 → 话题 → 聊天使用方向一致的进入与返回动画。
- 从屏幕左边缘向右拖动返回上一层；未达到提交阈值或被取消时回弹，不提前改变页面身份。
- 返回按钮、Android 系统返回键、边缘手势遵循同一返回语义。
- 设置和已连接状态下的连接页面支持返回；初始配对页无上层时不生成虚假返回。
- 遵从系统减少动态效果设置，保留操作结果，不强制位移动画。

## 状态与冲突约束

- 不把全屏左右滑动作为导航手势；纵向列表、聊天滚动、输入、文字选择、图表及媒体操作保持原有职责。
- 单指、左边缘、明显向右的横向移动才取得返回手势；多指、取消和未达阈值均不得提交返回。
- 取消手势不得清空输入、附件或丢失当前滚屏位置；设置覆盖聊天时保留聊天组件身份。
- 保存期间及会丢弃正在编辑表单的手势受到保护，不引入自动保存或自动提交。
- 快速点击、动画中重复返回、卸载及异步打开话题应有明确归属，不让过期动画或请求切换到错误页面。
- 保留既有消息投影、网络恢复、权威身份与本地待发送逻辑。

## 验收

执行卡：`default / t_776949ac`；实现子卡：`t_d1644ff8`（归属关系，不作为前置依赖）。

自动验证需覆盖实际生产组件与回调：进入/返回方向、拖动与回弹、触发阈值、纵向与多指拒绝、系统返回、减少动态效果、快速操作及清理；同时运行手机全量测试、TypeScript、iOS/Android Metro 导出。

设备验收独立记录：iPhone 左边缘跟手与取消、输入法打开时导航、短/长聊天与阅读位置、设置返回、表单保护、系统减少动态效果；Android 系统返回与手势。Node 原生模块替身和 Metro 导出不证明真机手感。

## 发布边界

实现阶段仅隔离分支验证；Jamie 随后明确要求“发布”，授权发布结果见文末。发布范围仅为既有 Expo 客户端，不修改 Gateway、插件或其他实例。

## 实际结果

主控独立执行并通过：

- `apps/mobile`: `npm test`，246/246 通过，无跳过。
- `apps/mobile`: `npm run check`，TypeScript 通过。
- `npx expo export --platform ios --platform android --no-bytecode --max-workers 2`，双端导出通过。
- `git diff --check` 通过。

实现复用 RN Animated 与祖先 responder，不新增依赖。前进页从右侧进入，按钮返回时目标页从左侧短距离进入；边缘返回跟随手指，完成后切换身份，取消回弹。仅一个活动内容树，不复制挂载退出的聊天页，避免重跑滚动、附件及 ref 副作用。手势预览只显示不可操作、对辅助阅读隐藏的频道/话题列表。

祖先捕获只处理从内容左侧 24pt 内开始的单指横向手势，不用透明覆盖条截住列表边缘的纵向滚动。阈值为内容宽度的 30% 且至少 55pt；多指、纵向开手及失去 responder 均不返回。减少动态效果时仍可返回，但不位移或回弹动画。

设置内未保存编辑阻止意外侧滑；明确点击 Close / Android 返回仍可放弃编辑，避免无效输入或保存失败时被困。保存名称、字体或模型期间阻止关闭。频道表单有 Cancel，未保存话题标题需清空后返回。连接页沿用现有配对状态规则，仅已连接且非配对提交中允许侧滑返回。

主控额外修正并验证：返回后持续可点击、连续返回手势、拒绝返回后下次进入正常动画、多指无移动就取消、过期动画与卸载、减少动态效果取消不启动 spring、坐标偏移与无覆盖条。

日志和双端 bundle 保留在私有路径 `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/navigation-motion/`：`parent-tests.log`、`parent-export.log`、`export/metadata.json`。最终 exports 是 JS 验证产物，不是独立安装包或真机验收。iPhone/Android 设备手感、系统文字选择及键盘打开时的实际交互仍待发布后验证。

实现验收时运行主目录为干净的 `19b6715`，候选保存在 `jamie/navigation-motion` 分支。

## 授权发布结果

- 发布卡 `default / t_8edb2f96`。运行目录 fast-forward 到 `4c44bb07b8db2e3c1c684aa72e56180967036f85`，再次运行 246 项手机测试和 TypeScript 检查，仅重启 `hermes-app-expo.service`。
- 公网 `https://agent.tuly.space/` 的 iOS/Android manifest 与各自精确 launchAsset 均成功下载，runtime 为 SDK 57；实际 bundle 包含页面身份、边缘 responder、返回阈值和设置保存保护。`/status` 返回 `packager-status:running`，未认证 API 仍为 401。
- `hermes-gateway-hermes-app-dev.service` 与 `hermes-gateway-jamie.service` 的 PID/启动时刻/运行状态逐项与发布前一致；开发配置哈希不变。未安装插件、未改核心、未重启 Gateway。
- 验证记录：私有 `workspace/hermes-app/navigation-motion/release-verification.json`，发布前记录 `release-before.json`，双端 manifest、实际 bundle 与发布测试日志同目录保留。首次 Python urllib 探针为 403，改用 curl 后公网两平台均验证通过。
- Git 回退基线 `19b6715` 保留。若需回退，先核对后续改动，再对 `4c44bb0` 创建反向提交并仅重启 Expo；不回退数据库或重启后端。
- 手机继续使用 `exps://agent.tuly.space`，重新加载 Expo Go 获取新包。真机手感、键盘与系统手势仍待实际设备确认。
