# 输入区上沿阴影与占位文字居中

## 已确认范围

- 输入区域上沿增加轻阴影；「＋」菜单展开后，阴影随整个输入区域上沿上移，不能遗漏菜单或在菜单与输入行间叠加阴影。
- 修正空输入框 placeholder 的纵向对齐，保留输入后的原生多行增长和清空复位。
- 保留返回最新所在透明行、消息底部 96pt 留白和现有键盘跟随。

## 原生排版修订（待发布）

Jamie 反馈 placeholder 仍未视觉居中，确认撤去额外字体排版干预：移除显式行高、includeFontPadding/textAlignVertical 覆盖，以及按应用/系统字体倍率计算高度和留白的逻辑。继续使用原生 placeholder 和字体度量，不新增占位层；保留原先 8pt 上下内边距、空输入 42pt 高度复位、非空多行增长和 120pt 高度上限。应用字号仍由已有 FontSize 包装器处理。

卡片 `t_1f0a1c12`。仅本地隔离候选，不改运行目录、不发布。TypeScript 与手机端串行测试 281/281 通过，日志：私有 `workspace/hermes-app/composer-native-text/tests.log`。新工作树先生成已有 Markdown renderer 与 client bundle，再运行完整检查；未增加依赖。组件测试验证没有额外字体排版覆盖及输入/清空行为；真机视觉与系统大字体是否受既有 42pt 高度限制仍需设备验收，不能以样式断言代替。

## 原发布实现方案（以下为历史记录）

- 在 ChatTimeline 为实际输入区域增加一个共用白色阴影容器，包住普通输入行或整个 AttachmentComposer（含菜单、提示、附件预览）。返回最新行留在容器外。使用现有 React Native boxShadow，向上偏移，不新增依赖。
- 保留原平台字号，明确行高；空输入的上下 padding 根据应用及系统字体倍率等量计算，输入高度至少 42pt，并为大字体保留上下空间。Android 关闭额外字体 padding。多行输入仍从上方开始，不固定非空输入高度。

## 验证与发布边界

卡片 `t_7a83add6`。Jamie 明确授权后，已将实现提交 `fd0570f21f956b8c96d524571855b470dbbfe88e` 发布到手机开发入口 `exps://agent.tuly.space`；真机视觉另验。

- 最终版本手机测试串行 281/281 通过，TypeScript 检查通过。
- iOS/Android Metro export 均通过，导出的实际 JS 资源包含阴影样式；资源哈希与日志保存在私有 `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/composer-shadow/`。
- 组件测试覆盖单一共用阴影容器、附件菜单开合、返回最新行不被纳入实色阴影面板，以及四档应用字号与三档系统字号下的对称 padding、多行增长、清空复位。原有键盘与阅读位置回归通过。
- 初次 Metro 导出因工作树 node_modules 符号链接指向 watchFolders 之外而找不到 expo-router/entry；改用隔离的本地依赖副本后通过，未改项目 Metro 配置或运行目录。
- 发布前基线为 `5e81956`；运行目录以 fast-forward 合入，仅停止/启动 `hermes-app-expo.service`。两个 Gateway 的 PID/启动时间及已安装插件文件哈希保持不变。
- 公网 iOS/Android manifest 与各自精确 launchAsset 已核验：共用阴影、按应用/系统字体倍率计算的 placeholder padding、透明最新行及 96pt 留白均包含在实际资源内。重启期间首次请求短暂 502，自动重试后双平台成功。
- 发布证据：上述私有目录的 `release-before.json`、`release-verification.json`、双平台 manifest 与 `release.py`。回滚应针对实现提交创建明确 revert，不覆盖用户数据。
- 双平台导出已保留为私有目录下 `verified-exports.tar.gz`；本次已合并且干净的隔离工作树及复制依赖已移除，分支与提交保留。其他工作树未改动。
- 真机阴影观感、iOS 字体基线与系统大字体效果需设备验收，自动测试不能代替。
