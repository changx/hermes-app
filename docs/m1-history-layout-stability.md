# 历史布局稳定性：第一轮本地改动

## 本地检查点与 LCM 保存

- 客户端行为基线：`71ca64f7b339796ccccd3f7525e7e5a15268b26d`。
- 按 Jamie 要求先提交检查点记录：`dc91e41`，本地 tag `checkpoint/history-layout-before-71ca64f`；源码未改。
- Jamie 随后明确要求保存重要 LCM 改动：开发 LCM 源码仓库已干净且提交在 `19845a77c7cd1ae0ba3f8b04492abea57b0087b7`；两份安装/恢复文档单独提交为 main `111953a`。没有提交凭据或改配置/重启 LCM。
- UI 分支在代码修改前同步该文档提交，检查点记录的新位置 `9f82ef1`，另有 tag `checkpoint/history-layout-after-lcm-111953a`；原 tag 仍保留。

## 实现范围

保留 FlashList 2.3.2、5 个阅读段、71ca64f 的松手加载/淡入/独立 tail 恢复。没有恢复已回退的 momentum gate，没有修改 SDK/API 或业务层补滚。

1. `drawDistance` 在实际 viewport onLayout 后设为约两屏，低于该值的小视口保持最小 250。不是无限渲染或永久 keep-alive；降低在视口内才首次测量的概率。
2. 使用稳定、O(1) 的 `getItemType` 区分 notice、工具行、用户/附件、短长正文，使 FlashList 各类尺寸统计分开。不逐帧重新解析 Markdown，也不使用旧版 estimatedItemSize/overrideItemLayout.height。
3. MessageAttachments 的 loaded 状态使用官方 `useLayoutState`，让本地状态变化进入 FlashList 的布局协调，不只等待晚到 onLayout。
4. 图片附件一开始就保留 62×62 缩略图槽，URI/加载状态前后维持相同文字列宽与基本行高。重新挂载时不再先出现一个无图的小行再长高；仍只使用认证 SDK 下载和原文件生命周期。

第一轮仍保留 maxItemsInRecyclePool=0。直接启用回收会要求更多消息身份相关状态处理（图片/视频/WebView/entering），不在这轮贸然混入。故本轮没有消灭按需渲染，目标是稳定其测量输入并利用现成布局能力。

## 验证与已知边界

- baseline-red：71ca64f 的附件组件在图片下载前没有缩略图槽；新几何不变量验收失败，候选通过。
- 6 项针对性回归通过：预渲染尺寸、类型分类、真实 timeline 配置、不新增 app-level 滚动修正、附件加载/重挂载尺寸不变量、真实 useLayoutState 通知。
- 使用已安装 FlashList 真实 LayoutManager 和 Controller 验证：一批最终尺寸到位后，由其自身 scrollAnchor 补偿，当前 key 的视口相对位置不变；更换当前阅读锚点后，下一次布局变化以新基准补偿，不拉回旧位置。
- 上述几何/原生指令是明确的受控输入。测试显式同步当前 visible anchor，因此它证明库算法在可靠尺寸/当前锚点输入下的性质，不证明真实 iPhone 每帧锚点跟踪已经没有问题。没有 monkey patch 或在 app 中调用/复制私有 controller。
- 完整 mobile **361/361**、TypeScript、双平台 Expo 导出、实际 bundle 新能力标记和 diff check 通过。原键盘/5 段/prepend/请求/状态/附件与淡入回归保留。
- 真实 iPhone 已加载历史来回浏览仍待确认；库动态高度/事件时序的其他跳位可能仍存在。本轮不能称“彻底修复所有浏览位置变化”。

代码在隔离分支 `jamie/session-history-layout-stability`。当前 main 仅多了获授权的 LCM 文档提交，手机运行行为仍为 71ca64f；没有部署 UI、重启 Expo/Gateway 或修改 node_modules。

证据：`/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/session-history-layout-stability/`。

参考：已核对官方 usage/v2-changes/recycling 文档和已安装 v2.3.2 的类型预测、useLayoutState、布局管理及锚点代码。
