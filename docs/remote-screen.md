# 桌面版 Remote browser：查看和操作服务器上的 AdsPower 屏幕

状态：已实现。本地和服务器上的验证已通过（见第 7 节）。还没有发布。macOS 真机验收待完成。本文区分**已确认需求**、**已验证事实**和**待验证项**。

## 1. 目标

AdsPower 的浏览器运行在服务器（ovh01）上，以前没有人能看到它的屏幕。现在桌面版提供一个 Remote browser 标签页：
- 用户可以实时看到 Agent 用 AdsPower 做了什么。
- 遇到登录、验证码、2FA 时，用户在这个标签页里直接操作。不需要先停掉 profile，再到自己的设备上登录。

## 2. 已确认需求（Jamie，2026-11-09）

1. 用 noVNC 把 AdsPower 的屏幕导出来，在桌面 App 里直接看到远程桌面。
2. 不使用 Hermes 内置的 Bot Screen。Bot Screen 的接管锁不管 `cdp_url` 浏览器，而且它的面板只在 Hermes Desktop 里。
3. 不开新的公网端口，不另设 VNC 密码。访问权限与现有的设备凭证一致。
4. 第一版只做桌面端，手机端以后再做。

## 3. 架构

```
AdsPower SunBrowser 窗口
  └─ Xvnc :120（X 显示 + RFB 服务，同一个进程；无 TCP 端口，无密码）
       └─ Unix socket /run/user/<uid>/adspower-screen/rfb.sock（0600，目录 0700）
            └─ hermes_app 插件：GET /v1/remote-screen（WebSocket，设备凭证或管理员令牌）
                 └─ 桌面版主进程：带凭证的 WebSocket（relayRemoteScreen）
                      └─ MessagePort（凭证不进入页面）
                           └─ Remote browser 标签页：noVNC（PortChannel）
```

- **服务器**：`adspower.service` 的 `run.sh` 把 `Xvfb :120` 换成 `Xvnc :120`。Xvnc 只监听 Unix socket：`-rfbport=-1 -rfbunixpath <socket> -rfbunixmode 0600 -SecurityTypes None -AlwaysShared`。显示尺寸保持 1920×1080。另外启动 openbox，配置为 `openbox-rc.xml`：
  - 不设快捷键，所有按键都送到浏览器。
  - 不强制窗口尺寸，窗口仍由浏览器决定，所以指纹里的窗口尺寸不变。
  - 用户可以手动移动或最大化窗口，比如登录弹窗。
- **插件**（`hermes-app-plugin`，`remote_screen.py`）：
  - 在 profile 的 `.env` 里设置 `HERMES_APP_REMOTE_SCREEN_SOCKET`（socket 的绝对路径）。设置后，capabilities 里出现 `remote_screen: {protocol: 1, name}`。名字来自 `HERMES_APP_REMOTE_SCREEN_NAME`，默认是 `Remote browser`。
  - WebSocket 只转发二进制 RFB 字节，不解析内容。
  - 插件拒绝以下 socket：不是 socket、不属于本用户、组或其他人可以访问。这时插件返回 503。
  - 每个 profile 最多 4 个查看者。超过时返回 429。
  - 插件每 30 秒重新验证一次凭证。凭证被撤销后，插件用 1008 关闭连接。
- **桌面版**：
  - 侧栏的 Search 下方，每个有屏幕并且在线的连接显示一个入口，入口名称就是屏幕名称。
  - 点击入口后，App 打开这个连接的 Remote browser 标签页。每个连接只有一个这样的标签页。
  - 标签页只能连接自己所属连接的屏幕（`remoteScreenTarget`）。页面不能指定其他连接。
  - noVNC 单独打包成 `dist/renderer/novnc.js`，只有 Remote browser 标签页加载它。noVNC 1.7 的 `core/util/browser.js` 里有一个 top-level await，iife 格式不支持它。`build.mjs` 在构建时把它改成 `.then()`。这一行变了时构建会失败，提示需要重新检查。

## 4. 使用

- 打开标签页后，默认是只看模式（View only），键盘和鼠标不发送到服务器。
- 点击 **Use the screen** 后，边框变红，键盘和鼠标发送到服务器。再点 **Stop using** 回到只看模式。
- Mac 快捷键在远程 Linux 浏览器上也能用：
  - Cmd+字母、Cmd+数字变成 Ctrl+字母、Ctrl+数字。字母按当前键盘布局取。
  - Cmd+← / → 变成 Home / End，Cmd+↑ / ↓ 变成 Ctrl+Home / Ctrl+End。
  - Cmd 键本身不发送。
- 剪贴板：
  - Cmd+V 先把 Mac 剪贴板里的文字送到服务器，再发送 Ctrl+V。主进程只在 Remote browser 标签页按下 Cmd+V 时读取剪贴板。
  - 远程复制的文字会写入 Mac 剪贴板。
- 画面按面板大小缩放，不改变服务器的分辨率。
- 标签页在后台 30 秒后自动断开，以节省流量。回到标签页时自动重连。

## 5. 恢复和提示

- 连接断开时，App 在后台自动重试，间隔依次为 2 s、5 s、10 s、30 s。重连不要求用户做技术判断。
- 只有真正有问题时才显示提示，用普通用户能理解的话：
  - 屏幕没有运行：`AdsPower is not running on the server right now.`，可以点 Try again，后台也继续重试。
  - 凭证被撤销：提示重新配对，不重试。
  - 服务器没有设置屏幕：提示未设置，不重试。
  - 连接离线：提示离线，连接恢复后自动重连。
- 第一版限制：Agent 和用户可以同时操作这个浏览器，没有锁。用户接管时，Agent 的 `browser_*` 工具不会暂停。

## 6. 部署（需要 Jamie 授权）

1. 在 `/home/hermes/.hermes/profiles/jamie/workspace/adspower/` 中，把 `run.sh.candidate` 替换为 `run.sh`，把 `openbox-rc.xml.candidate` 替换为 `openbox-rc.xml`。保留旧的 `run.sh` 作为回滚版本。
2. 重启 `adspower.service`。**警告：重启会关闭所有正在运行的 AdsPower profile。jamie 和 hermes-app-dev 两个 profile 正在进行的浏览都会中断。**
3. 检查 Xvnc 和 socket：
   - socket 的权限是 0600，目录的权限是 0700。
   - `ss -ltnp` 里没有新的 TCP 端口。
   - Local API 正常，并且 `adspower_cdp.sh start` 能启动 profile。
4. 在 hermes-app-dev 的 `.env` 里设置以下两项，然后安装插件：
   - `HERMES_APP_REMOTE_SCREEN_SOCKET=/run/user/1001/adspower-screen/rfb.sock`
   - `HERMES_APP_REMOTE_SCREEN_NAME=AdsPower`
5. Jamie 重启 Gateway。
6. 发布签名并公证过的桌面版，然后在 Mac 上验收。

回滚步骤：
1. 换回旧的 `run.sh`，然后重启 `adspower.service`。
2. 删除 `.env` 里的两项设置。删除后，capability 消失，桌面版的入口也会隐藏。

## 7. 已验证事实（2026-11-09，ovh01）

| 项目 | 结果 |
|---|---|
| SunBrowser 在 Xvnc 上显示 | 启动参数 `--display=:121` 生效，`wmctrl` 显示 SunBrowser 窗口在 `:121` 上 |
| Unix socket 的 RFB 握手 | `RFB 003.008`，安全类型 None，画面 1440×900 和 1920×1080 都正常 |
| 插件路由（真实 aiohttp + 真实 Xvnc） | capability 和名称正确；无凭证 401；socket 不存在、权限过宽、不是 socket 时 503；查看者上限 429；令牌轮换后 1008 |
| 构建出的 `novnc.js` 在 headless Chrome 里 | 画面 1440×900；点击后指针坐标到达 X 服务器；输入框读回 `Hello noVNC 123`；Ctrl+A 加退格清空；Ctrl+L 后输入网址并回车，远程页面变为 `https://example.org/` |
| Electron（真实 preload、`relayRemoteScreen`、`RemoteScreenPage`，Xvfb 上运行） | MessagePort 转发正常；只看模式下打字不到远程；Use the screen 后打字到达远程；Cmd+A 和 Cmd+V 后远程输入框的值是 Mac 剪贴板的 `pasted from mac`；屏幕停止时显示“not running”；令牌错误时显示重新配对 |
| 指纹尺寸 | 测试 profile 报告的 `screen` 是 1920×1080，等于实际显示。openbox 不强制窗口尺寸 |

## 8. 待验证项

- 在 Mac 真机上验证以下几项：
  - 外观。
  - 中文输入法，因为 noVNC 发送的是 keysym。
  - Cmd 快捷键。
  - 剪贴板。
  - 断网后自动恢复。
  - 走 Cloudflare 公网时的流量和延迟。
- 部署后，用真实的 AdsPower 默认 profile 完成一次登录交接。
