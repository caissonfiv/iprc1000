# 最新进展：2026-11-12 驱动 UI 0.4.0

- 0.1.2 驱动已由用户实机确认 RUNNING、connected=1 和映射成功。根因之一是未定义 KMDF 编译版本宏，使最低版本成为 0xFFFFFFFF；现已修正并增加二进制检查。
- 桌面主入口默认运行 src/driver-app.js，ui/driver.html + driver.js 复用旧遥控器图形。driver-client.js 调用配套 CLI snapshot/apply，经 ABI 1 读写完整策略。
- UI 启动只读，启停保留绑定，关闭后映射继续。应用是 RAM，保存到设备是显式持久化。组合键、语音、文字暂不支持。
- 打包：先生成 driver-bin/iprcctl.exe，再 npm run dist。scripts/package-driver-ui.cjs 使用文件白名单生成仅驱动版本，包含 Electron 但不带 Interception/HID/注入依赖。
- 22 项 Node 回归、原有测试脚本及最终便携包 Electron 模拟驱动自检通过。用户已确认管理员 UI 测试成功；重连与电源场景继续验证；不要把模拟测试写成硬件验证。
- 0.1.2 已安装包保持原样。UI 包内有新版用户态 CLI，无须重新安装 .sys。本轮未写入真实映射、设备/驱动安装状态或安全配置。

---
# HANDOFF · IPRC1000 蓝牙语音遥控器 → Windows 映射

> 历史交接快照：0.3.0 已重构接管生命周期、注入队列和默认配置；现行行为见 CHANGELOG.md。本文中的三级降级、默认键位数量及部分故障根因解释描述的是旧版本。

> 交接给：任何要继续维护的人（包括三个月后的我自己）
> 仓库：<https://github.com/caissonfiv/iprc1000> · 最后更新 2026-11-12
> 读法：只想知道怎么用 → 看 [README](README.md)。想知道**为什么写成这样** → 看本文第 5 节。

---

## 0. 一句话

Verizon FiOS 的 IPRC1000（Broadcom BCM20734）在 Windows 眼里就是一把**普通键盘**：
22 个键全发标准 PS/2 扫描码，语音键等于字母 `m`；而它的麦克风走一条**没有任何用户态 API
能订阅**的私有 L2CAP 通道。这个项目把这两件事都解决了，代价是踩了 20 多个坑，
其中 4 个坑的代价是「整台机器键盘鼠标失灵」或「满屏 mmmmmm 停不下来」。

---

## 1. 交接时点的状态

### ✅ 真的能用了

| 能力 | 验证方式 |
|---|---|
| 22 个键全部识别并改键（单击 / 组合键 / 媒体键 / 粘文本 / 不执行） | 全部实测绑过一遍 |
| 按键**不再往窗口打字** | 接管模式，装 Interception 驱动后 |
| 幽灵键 `0x17` 拦掉 | 接管模式下被 `native`/吞键逻辑吃掉 |
| 遥控器麦克风抓成 WAV | `out/mic.wav`，16 kHz 单声道，峰值 −16.1 dBFS，**听到了本人声音** |
| 麦克风实时从扬声器出来 | `mic-live.cmd` |
| 变成系统「麦克风」 | VB-CABLE，`CABLE Output` 已是默认录音设备 |
| 按住语音键说话 → 文字上屏 | 走 Windows 语音输入 Win+H，端到端验证过 |
| 桌面程序 + 遥控器图直点改键 + 绑定向导 | Electron 打包成 `IPRC1000.exe` |

### ⚠️ 有条件 / 有限制

- 「不打字」**必须**装 Interception 驱动 + 重启一次。不装就是观察模式，键照样打进窗口。
- 观察模式下 `0x17` 幽灵键只能被程序忽略，那个 `i` 已经打出去了，拦不住。
- 语音转文字**依赖联网**（Win+H 是云识别），且要求 `CABLE Output` 是默认录音设备。
- WorkBuddy 自带语音键（Ctrl+D）只在它自己窗口前台时有效，不是全局热键。

### ❌ 没做 / 做不到

- **拦住麦克风那条 L2CAP 通道**：它被 HID 驱动独占，用户态无解，只能 ETW 旁路抓包。
- **改遥控器固件的 6 秒重发**：这是设备行为，程序只能识别并静音，不能让它停。
- **按住语音键「续说」**：Win+H 一旦弹出就是它自己管，遥控器松开只是结束注入。

---

## 2. 时间线：三天，四次转向

文件 mtime 基本就是开发顺序，可以按这个回溯。

| 时间 | 阶段 | 产出 | 转折点 |
|---|---|---|---|
| 11-09 23:37–23:40 | **侦察** | `hid_desc` `recon` `selftest` `diag` `learn` `rawlist` | 读报告描述符确认：只有 Keyboard 集合，没有音频端点 → 麦克风不可能走标准通道 |
| 11-09 23:43–11-10 00:11 | **第一次打通按键** | `devices.js` `rawinput.js` `hidsource.js` | Raw Input 能用，但键同时打进窗口 → 必须换方案 |
| 11-10 20:50 | **探驱动** | `intercept_probe.js` | 确认 Interception 是唯一能「按设备吞键」的路 |
| 11-10 21:07–21:34 | **麦克风攻坚** | `wav.js` `capture_mic.js` `mic_live.py` | ETW 旁路抓 HCI → 重组 L2CAP → 剥帧头，听到人声那一刻是转折点 |
| 11-10 22:04–22:54 | **桌面化** | `ui/index.html` `icon` 打包 `store.js` `layout.js` | 从网页改成独立程序，遥控器图直点改键 |
| 11-11 00:06–00:49 | **接管模式落地** | `interception-ffi` `test_stroke` `model.js` | KEY_UP 常量漏了 → 「每个键只能按一次」 |
| 11-11 19:15–19:18 | **★ 那次锁死后的总修** | `intercept-worker` 重写、`inject` 拆拍、`test_combo`、心跳 | 键盘鼠标全失灵，被迫把「接管线程」当成一个会死的服务来设计 |
| 11-11 19:48 | **卡键识别** | `stuck.js` `test_stuck` | 发现 6.000 秒硬周期 = 机器在发 |
| 11-11 20:00 | **重复上报抑制** | `latch.js` `test_latch` | 5 秒兜底 < 6 秒周期 → 按一次变一串 |
| 11-11 21:06 | **收口** | `app.js` 看门狗整合 | 三层刹车齐了 |
| 11-12 00:26 | **发布** | `README` `.gitignore` GitHub | 隐私清理：录音、截图、硬件 ID 全部排除 |

---

## 3. 架构：三条互不相干的流

```
                    ┌─ 接管模式 ─────────────────────────────┐
遥控器 ──蓝牙HID───►│ Interception worker（子线程，阻塞式）   │──┐
                    └────────────────────────────────────────┘  │
                    ┌─ 观察模式 ─────────────────────────────┐  ├─► handleEvent()
                    │ Raw Input（隐藏窗口 + INPUTSINK）       │──┘        │
                    └────────────────────────────────────────┘            │
                                                                          ▼
                                          PressLatch（是不是重复上报？）
                                                                          │
                                          StuckGuard（是不是机器在连发？）
                                                                          │
                                          dispatch() ──► SendInput / 粘文本
                                                                          
遥控器 ──蓝牙 L2CAP(私有)──► ETW(BthPort) ──► etw_consumer.exe ──UDP:31680──►
     mic_live.py ──► CABLE Input ──(驱动回环)──► CABLE Output ──► Win+H
```

**为什么按键核心在子进程里？** Electron 渲染/主进程 + koffi 阻塞调用 + Raw Input 窗口消息
放一起会死锁（见 C2）。所以 `main.js` 只做窗口壳，核心 `src/app.js` 作为独立 node 子进程跑，
两边靠本地 HTTP(7788) + SSE 通信。

### 三级降级（`connectSource`）

```
装驱动且抢到 → intercept（吞键，最好）
抢不到/没装   → hid      （直读，实测必失败，保留只是诊断用）
都没有       → raw      （Raw Input，永远可用，但会打字）
```

关键：**降到 raw 之后必须能自己爬回 intercept**。这里出过一次大事故（B9）。

---

## 4. 已经测死的事实

> 这一节的东西都实测过，别再花时间重新验证。有疑问先看第 5 节对应的坑。

### 4.1 22 个键的扫描码（PS/2 set 1）

| 坑位 | 码 | 打出来 | | 坑位 | 码 | 打出来 |
|---|---|---|---|---|---|---|
| `pwr` 电源 | `0x14` | — | | `fav` 收藏 | `0x12` | — |
| `back` 返回 | `0x21` | — | | `mic` 语音 | **`0x32`** | **`m`** |
| `up` 上 | `0x48` | ↑ | | `me` 我的 | `0x24` | — |
| `menu` 菜单 | `0x31` | — | | `rew` 快退 | `0x33` | — |
| `left` 左 | `0x4B` | ← | | `play` 播放 | `0x2B` | `\` |
| `ok` OK | `0x1C` | Enter | | `ffwd` 快进 | `0x2F` | — |
| `right` 右 | `0x4D` | → | | `volup` 音量+ | `0x03` | — |
| `exit` 退出 | `0x20` | — | | `voldown` 音量− | `0x04` | — |
| `down` 下 | `0x50` | ↓ | | `mute` 静音 | `0x22` | 媒体静音 |
| `info` 信息 | `0x23` | — | | `chup` 频道+ | `0x1E` | — |
| `last` 上一频道 | `0x2E` | — | | `chdown` 频道− | `0x30` | — |

幽灵键 **`0x17`**（=`i`）：几乎每按一次键，80–400 ms 后补发一次，必须过滤。

> ⚠️ **命名陷阱**：代码里这个字段叫 `usage`，注释写着「HID usage ID」，但**这台设备上它
> 实际是 PS/2 扫描码**（`0x32`=`m` 是扫描码，HID usage 里 `m` 是 `0x10`）。
> 观察模式读 Raw Input 的 `MakeCode`、接管模式读 `InterceptionKeyStroke.code`，
> 两条路**碰巧**都是扫描码，所以能共用一张键位表。这是经验巧合，不是设计保证——
> 换一支遥控器务必先 `node scripts/learn.js` 重新确认。

### 4.2 麦克风帧格式

```
L2CAP 负载 653 字节
[0..12]   13 字节头   A1 F7 01 <seq> 00 <roll> <n> <cnt> 00 00 00 40 01
[13..652] 640 字节  = 320 × int16 LE @ 16 kHz（20 ms 一帧）
```

- `<seq>` 每帧 +1（1 字节回绕）→ 可以**测量**丢帧，不用猜。
- ACL 上常拆两片，**切片方式不固定** → 必须按 PB 标志 + L2CAP 声明长度重组，不能假设固定偏移。
- 上采样（16 k → 48 k）发生在 **`etw_consumer.exe` 里**：它在 UDP 上吐出来的**已经是 48 kHz /
  单声道 / int16 LE**，`mic_live.py`（`RATE = 48000`）只负责收包和播放，不做重采样。
  所以想改采样率要动那个 exe，改 Python 没用。

### 4.3 6.000 秒重发指纹

语音键按下后如果握手没被收尾，固件**每 6.000 秒重发一次同一个键**，抖动几毫秒，
能连续发 5 分钟以上。人按不出这种节奏 —— 这就是「机器在发」的判据。

**已验证是设备侧行为**（不是程序 bug）：关掉整个程序，`m` 照样自己冒；
关掉蓝牙，按语音键红灯仍然闪。

单次物理按压还会补发一份，间隔 45–109 ms。

### 4.4 灯语

| 现象 | 含义 |
|---|---|
| 按语音键亮**红**灯 | 正常，麦克风在工作，松手灭 |
| 装电池亮一下**绿**灯 | 正常，开机自检 |
| **没按**语音键红灯却亮着 | 语音键卡在开麦状态 → 取电池重装 |
| 绿灯**一直闪** | 它认为没配对 → 重新配对 |

### 4.5 两条走不通的路（别再试）

1. **换驱动成「符合 HID 标准的设备」** → `ReadFile` 仍然 `0x5 拒绝访问`。
   拦点在 HID **类驱动层**，跟下面绑 `kbdhid` 还是通用驱动无关。
2. **`WH_KEYBOARD_LL` 低层钩子** → 钩子拿不到「按键来自哪台设备」，
   吞掉遥控器的 `m` 会连物理键盘一起吞。

---

## 5. 卡点全集

每条格式统一：**症状 → 当时的错误假设 → 实测到的真相 → 修法 → 防回归**。

### A 组：环境与工具链（不致命，但每次都浪费时间）

**A1 · `node` 不在 PATH**
系统里没有 node，真身在 `C:\Users\caiss\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`。
所有 `.cmd` 里要写绝对路径或先探测。误判过一次「没运行环境」。

**A2 · `ELECTRON_RUN_AS_NODE=1` 是预设的**
想用 `electron.exe` 跑纯 node 脚本，必须 `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS electron.exe x.js`。
不 `-u` 的两个后果：`electron.exe .` 崩 `app is undefined`；打包出来的 exe 卡在 42 MB 不动。

**A3 · koffi 回调不能写内联类型**
`koffi.proto('int(*)(int)')` 会报 `Unexpected character '('`。必须：
```js
const Pred = koffi.proto('int Pred(int device)');
const EnumDevices = ...('...', koffi.pointer(Pred));
```
另外**所有句柄参数必须是 `uint64`**，写成 `void*` 会在 x64 上被截断。

**A4 · 沙箱会拦一堆东西**
`reg.exe`、`Add-Type`、`[Reflection.Assembly]::Load*`、`csc.exe`、`New-Object -ComObject WScript.Shell`、
从 Bash 调 `powershell` —— 全拦。要注册表就改写 `.reg` 文件让用户双击，
要系统信息就 `fsutil dirty query %SystemDrive%`（别用 `net session`，那个会循环弹 UAC）。

**A5 · localhost 有代理**
`curl http://127.0.0.1:7788` 报 `upstream connect failed`，必须 `curl --noproxy '*'`。

**A6 · `.cmd` 换行必须是 CRLF + 纯 ASCII**
UTF-8 + LF 的 `.cmd` 会被当 GBK 读，中文全乱、路径解析失败。踩过一次「运行失败」。
现在 `.gitattributes` 强制 `*.cmd text eol=crlf`。

---

### B 组：输入链路（真正的事故区）

**B1 · `ReadFile` 读遥控器 HID 永远 `0x5 ACCESS_DENIED`**
Windows 在 HID 类驱动层就禁止普通进程读顶层集合为键盘/鼠标的设备。无解，绕。

**B2 · 换驱动（见 4.5）**
浪费了半天。而且「删除设备 + 重新配对」还会把改动丢掉。

**B3 · `WH_KEYBOARD_LL`（见 4.5）**
做不到按设备区分。

**B4 · `WM_INPUT` 静默丢失：`HRAWINPUT` 在 `lParam` 不在 `wParam`**
症状：按了键完全没反应，也不报错。
x64 上 `MSG` 布局是 `hwnd(8) message(4) wParam(8) lParam(8)`，
`HRAWINPUT` 在 **`lParam`（偏移 24）**。从 `wParam`（偏移 16）读拿到的是键盘虚拟键码，
`GetRawInputData` 直接返回 0，看起来「什么都没发生」。

**B5 · ★ 设备槽位复用 → 键盘鼠标全失灵**
症状：一夜之间键盘像死了、按键乱跳、鼠标点击也怪。
真相：Interception 按**槽位号**认设备。遥控器曾在 #7，休眠断开后 #7 被另一把键盘占用，
程序继续按号吞键 → 把**别人的键**吞了。
修法：每收一个报文先核对「这个槽位现在的硬件 ID 还是不是遥控器」，变了立刻缴械
（`intercept-worker.js`，约 10 秒 `goneCount >= 40` 后 disarm）。
另加「打字检测」：1.2 秒内 6 个以上**不同**扫描码 = 人在打字（遥控器一次只按一个键）→ 立刻缴械，
且该键先原样放行，不能吞掉用户正在按的键。

**B6 · 匹配遥控器的正则写成了「或」**
`/0A5C|8502/` —— 串号里带 `8502` 的**其它设备**也会被认成遥控器。
改成「VID 必须是 `0A5C` **且** PID 必须是 `8502`」。

**B7 · ★ 每个键只能按一次**
症状：「按过一次就再也没反应」。
真相：`interception-ffi.js` 的 `load()` 漏返回 `KEY_UP/KEY_E0/KEY_E1`，
于是 `state & undefined === 0`，**每一次「抬起」都被判成「按下」**。
第一次按下去就 latch 住了，之后全是「已经在按」。
修法：导出常量 + `BAD_CONST` 守卫（常量为 undefined 直接抛错，不许静默算错）+ `held` 兜底。
防回归：`scripts/test_stroke.js`，16 条。

**B8 · 幽灵键 `0x17` 从没被过滤**
过滤阈值写的是 60 ms，实测补发间隔 18–39 ms → 一条都没拦住。
改成 `PHANTOM_MIN_MS = 8`，上限 500 ms。

**B9 · ★ 满屏 mmmmmm #1：降级之后再也爬不回来**
症状：不说话也隔几秒冒一个 `m`，每 6.0 秒一次，连着五分钟。
日志顺序：`遥控器已断开` → `接管模式不可用：没有找到遥控器键盘设备` → `遥控器已连接`，
**然后再也没有** `▶ 接管模式已启用`。
真相两个 bug 叠在一起：
1. 失败分支把 `interceptTried` 置真后**永不复位**，重连分支又只认 `sourceKind === 'intercept'`
   才重置 → 永远停在 raw 模式，按键照常打进窗口。
2. 降级后没有任何机制把它拉回 intercept。
修法：设备重新出现时**无条件**重置接管状态；另加 2 秒一次的**接管看门狗**
（失败按 `5s×2^n` 退避，封顶 60 秒/次）。
附带发现：`/api/panic` 只撤接管、raw 仍在派发 → **急停形同虚设**，加了 `panicStop` 一票否决。

**B10 · ★ 满屏 mmmmmm #2：遥控器自己在发（见 4.3）**
修法：`src/stuck.js`。同一个键以几乎相同间隔（抖动 < 350 ms、每次至少隔 0.8 s）来 **3 次**
→ 判定卡键，静音该键 **30 秒**；再犯翻倍 60 → 120 → … 封顶 15 分钟；10 分钟不犯自动清零。
静音期间**一个键都不注入**。面板弹红条，可手动解除。
`need` 从 4 降到 3：3 次 = 2 个间隔，够判了，判得越快屏上越干净。

**B11 · ★ 「按一下变成按了好几次」：5 秒 < 6 秒**
`held` 的静默兜底是 5 秒，重发周期是 6.000 秒。
设备漏发抬起（这正是现状），5 秒一到程序当成「已松开」，紧接着 6 秒那发重发
就被判成「又按了一下」→ 一次按压拆成一串。
修法：`src/latch.js`。重发**刷新时刻**而不是拒绝，兜底提到 **12 秒**（周期两倍）。
`scripts/test_latch.js` 直接反证：把 ttl 设成 5 秒，同一个用例必须复现 bug。

**B12 · ★ 组合键被塞进同一个 `SendInput` → Win 键卡住**
`Win↓ H↓ H↑ Win↑` 四件事挤在一次调用里，Windows 外壳按「输入拍」处理，
可能把按下+抬起当同一拍 → Win 留在按下状态 → 所有快捷键失灵、开始菜单乱弹，
体感是「按一下语音键就卡死」。
修法：`comboPlan()` 纯函数，每步间隔 **10 ms**，末尾再补一遍抬起（重复抬起无害）。
`scripts/test_combo.js` 18 条盯顺序与「不留卡键」。

**B13 · 接管线程卡在系统调用里 → 遥控器整个哑掉**
`interception_receive()` 是**阻塞**的，队列一空就永久挂住：过滤器还挂在设备上却没人读报文，
按键全被吞，连方向键都不动。而看门狗永远不触发，因为 `interception_wait()` **也是阻塞的**。
修法三件套：
- 接收循环改成单层 `waitTimeout(250ms)` 驱动，永远出得来；
- 线程每 ≤1 秒发心跳，主线程 **4 秒**收不到 → 销毁上下文自动重建；
- 线程死亡必须上报（以前被 `settle()` 的一次性判断吞了，主线程还以为一切正常）。

还有一个隐蔽的：`worker.terminate()` 是异步的，**旧线程的 exit 会晚到**，
把新线程误判成「掉了」→ 日志出现「启用 → 掉了 → 再启用」死循环。
修法：`const stale = () => worker !== w;`，所有消息/事件先过这一道。

---

### C 组：桌面化与 UI

**C1 · 录音对话框秒退**
三个原因叠一起：遥控器事件带着 `vkey: 0` 把对话框关了；语音键自重复触发取消；
服务端请求挂起。修法：`finishCapture()` 统一收口、监听 `req.on('close')`、20 秒超时、
`Cache-Control: no-store`。

**C2 · Electron + koffi/Raw Input 死锁**
主进程里同时跑阻塞 FFI 和窗口消息循环 → 互相等。
修法：核心挪到 node 子进程，主进程只当壳（见第 3 节）。

**C3 · 双击没反应**
程序是单实例的（Electron 的 `app.requestSingleInstanceLock()`）：已经在跑时，
第二次双击只会把旧窗口叫出来然后自己退出。排查时后台有 **5 个残留 `IPRC1000.exe`**
占着锁，之后每次启动都「秒退、啥也不显示」。
`stop.cmd` 用了 `taskkill /F /T`（`/T` 是关键，要连子进程一起杀）。

**C4 · 图标是自己画的**
没有图形库，`scripts/make-icon.js` 手写 PNG 编码 + ICO 容器。改图标跑 `npm run icon`。
（写这个时踩过一个莫名其妙的坑：替换内容里有个错字 `#cace d2`，被判定成敏感内容不可用。）

---

### D 组：音频链路

**D1 · 默认一帧都抓不到：`EtwDropLargeEvents = 1`**
`HKLM\SYSTEM\CurrentControlSet\Services\BthPort\Parameters` 里两个键是元凶：

| 键 | 默认 | 后果 |
|---|---|---|
| `EtwDropLargeEvents` | **1** | 大的 HCI 包**直接丢掉**，音频一帧都进不来 |
| `MaxEtwBytes` | 偏小 | 单包被截断，只剩半帧音频 |

必须先改注册表**并重启** —— BthPort 只在驱动加载时读这两个值。`enable-mic-capture.cmd` 干这个。

**D2 · L2CAP 切片不固定**
不能假设「第一片 27 字节、第二片 26 字节」这类固定偏移，
必须按 PB 标志 + L2CAP 声明长度重组。重组引擎在 `tools/etw_consumer.exe`
（来自 `lymsiq/IPRC1000-Adapter`，MIT）。

**D3 · VB-CABLE 的命名是反的**
`CABLE Input` = **播放**设备（往里写），`CABLE Output` = **录音**设备（从这读）。
名字看起来像接反了，实际就是这么设计的。写错一端就会「有电平但录不到」。

**D4 · ETW 必须提权**
不是「建议管理员」，是**必须**。没提权 ETW session 起不来，表现是桥接显示「运行中」但电平不动。
面板上那个 UAC 就是为这个。

---

## 6. 关键常量（改之前先看因果）

| 位置 | 常量 | 值 | 为什么是这个值 |
|---|---|---|---|
| `src/latch.js` | `ttlMs` | **12000** | 必须 > 6.000 秒重发周期。5 秒时直接导致「按一次变一串」 |
| `src/stuck.js` | `need` | 3 | 3 次=2 个间隔，够判；4 次太慢，屏上先脏了 |
| `src/stuck.js` | `jitterMs` | 350 | 机器 0–50 ms 硬周期，人手差三四百毫秒。两边都不夹 |
| `src/stuck.js` | `minGapMs` | 800 | 比这还短 = 人在连点，不算卡键 |
| `src/stuck.js` | `muteMs / maxMuteMs` | 30 s / 15 min | 指数退避，防止一直刷红条 |
| `src/stuck.js` | `streakResetMs` | 10 min | 长时间不犯就忘了，别让一次事故永久加倍 |
| `src/intercept.js` | `stalled` 阈值 | 4000 ms | 心跳 ≤1 s，4 倍容差 |
| `src/app.js` | 看门狗间隔 | 2000 ms | 接管失败退避 `5s×2^n`，封顶 60 s |
| `src/app.js` | 语音按住超时 | **20000 ms** | 漏发抬键时强制释放修饰键，防卡死 |
| `src/app.js` | `PHANTOM_MIN_MS` | **8** | 实测补发 18–39 ms；老的 60 一条都拦不住 |
| `src/inject.js` | `COMBO_GAP_MS` | 10 ms | 挤同一个 `SendInput` 会让 Win 卡住 |
| `src/inject.js` | 末尾补抬起 | +40 ms | 重复抬起无害，防万一 |
| `src/intercept-worker.js` | 打字检测 | 1.2 s / 6 个不同码 | 遥控器一次只按一个键 |
| `src/intercept-worker.js` | `goneCount` | 40 | 250 ms × 40 ≈ 10 秒确认设备真的没了 |
| `src/app.js` | 端口 | 7788 | 面板 HTTP；`PORT` 环境变量可改 |
| `src/app.js` | 音频 UDP | 31680 | `etw_consumer.exe` → `mic_live.py` |

---

## 7. 防回归测试

跑法：`node scripts/test_xxx.js`，全部零依赖、不需要设备、不需要管理员。

| 文件 | 断言 | 盯的是什么 |
|---|---|---|
| `test_stroke.js` | 16 | `InterceptionKeyStroke` 布局 + `KEY_UP` 语义（B7 那次事故） |
| `test_latch.js` | 19 | 「还按着吗」：重发只算 1 次、兜底不锁死、多键互不干扰 |
| `test_stuck.js` | 27 | 卡键识别：机器周期要抓到、人手连点**不能**误判、退避与清零 |
| `test_combo.js` | 18 | 组合键顺序、逆序抬起、末尾不留卡键 |
| 合计 | **80** | 全部通过才准提交 |

还有两个不常跑的：
`scripts/ui_sim.js`（面板录制逻辑的 DOM 仿真）、`scripts/test_capture.js`（服务端捕获链路）。

> 写测试的原则（吃过亏）：**每个 bug 都配一条「把参数改回错误值必须复现 bug」的反证用例**。
> 比如 ttl 设 5 秒时，那个「11 发重发只算 1 次」的用例必须失败。否则测试只是复述实现。

---

## 8. 遗留问题

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | 打包版实际键位表只有 12 条，其中 `0x23`（信息）和 `0x24`（我的）都绑成了 **Win+L**，`0x12`（收藏）绑成了 **Win+D** | 误按会锁屏 / 最小化所有窗口 | 这两个键改成「不执行」，等用户自己定 |
| 2 | `config/` 被 `.gitignore` 排除了，**22 个键的实测绑定只存在于 `dist/IPRC1000-win32-x64/config/`** | 重打包或换机就丢，得重新学一遍 | 备份一份到 `out/` 或另开 gist；或者把「已实测确认」的 22 条写进 `src/layout.js` 的 SLOTS 默认值 |
| 3 | 代码字段叫 `usage` 实际是扫描码（4.1） | 换遥控器会静默错位 | 改名 `scanCode` 或至少在 README 标注 |
| 4 | 观察模式下 `0x17` 只能忽略不能拦 | 会往窗口打个 `i` | 无解，只能靠接管模式 |
| 5 | README 里的 `23 个按键` 已修正为 22（与实际 SLOTS 数一致） | — | 已完成 |
| 6 | 遥控器电池建议换新（别用 1.2 V 镍氢） | 电压不足会加剧漏发抬键 | 用户侧待办 |

---

## 9. 如果继续做，建议的顺序

1. **先把 `config/` 的 22 条实测绑定固化进代码默认值**（遗留 #1、#2）。
   收益最大、风险最小：任何人拿到手就是能用的，不用先学一遍。
2. **把 Win+L / Win+D 两个危险绑定改掉**（遗留 #1 的安全问题，一行事）。
3. **接管模式加「一键体检」**：面板上按一下，依次检查 DLL 在不在、驱动服务 ImagePath 有没有、
   `UpperFilters` 有没有、能不能 `create_context`、当前几个键盘槽位分别是哪台设备。
   现在这些散在 4 个脚本里，用户出事时根本不知道该跑哪个。
4. **`stuck.js` 的静音改成「只静音重发、不静音首次按压」**。
   现在判定卡键后 30 秒内这个键完全不响应，用户会觉得「键坏了」。
   更好的行为是：静音掉那一串重发，但仍然接受「下一次真正的物理按压」。
5. **支持多条配置档**（家里/办公室各一套）。`store.js` 现在只有单文件。
6. 想彻底解决麦克风：需要在驱动层拦 L2CAP，等于自己写蓝牙过滤驱动。
   **不建议**投入，ETW 方案已经够用。

---

## 10. 环境备忘

```
项目路径    C:\Users\caiss\WorkBuddy\2026-11-09-23-32-38\iprc1000
node        C:\Users\caiss\.workbuddy\binaries\node\versions\22.22.2-6\node.exe（不在 PATH）
日志        开发：out\app.log　打包：dist\IPRC1000-win32-x64\resources\app\out\app.log
配置        开发：config\　打包：dist\...\config\　可用 IPRC_DATA 覆盖
单实例      Electron app.requestSingleInstanceLock()（不是文件锁）
打包        npm run dist → dist\IPRC1000-win32-x64\IPRC1000.exe（--asar=false）
驱动        Interception LGPL-3.0 · VB-CABLE 不可再分发 · etw_consumer 来自 IPRC1000-Adapter(MIT)
```

打包的一个坑：`--asar=false` 是故意的，改动靠 `cp` 单文件同步进 `resources/app/` 更快；
但如果直接 `--overwrite` 重打包，会撞上安全删除的批量确认（490 个文件），要先清 `dist/`。

---

## 11. 如果你只有 30 分钟

按这个顺序读/做，能覆盖 90% 的价值：

1. **10 min** — 跑一遍 `stop.cmd` → `npm start`，按几个键看日志，建立「正常长什么样」的直觉。
2. **5 min** — 读 `src/latch.js` 和 `src/stuck.js` 的文件头注释（各 15 行），
   这是全部坑里最难自学的两个。
3. **5 min** — 跑 `node scripts/test_latch.js`，看 ③ 那组反证用例，理解「参数错了会怎样」。
4. **5 min** — 看一眼第 6 节的常量表，特别是 `ttlMs` 和 `need` 的「为什么」列。
5. **5 min** — 按第 9 节第 1、2 条动手，这两件事半小时内能做完，且立刻提升可用性。

**如果出事了**，自救顺序永远是：面板「重新接管」→ `stop.cmd` 重开 → 遥控器取电池重装。
**如果键盘鼠标失灵了**，先按一下 Ctrl / Shift / Win / Alt 四个物理键释放卡住的修饰键（B12），
再 `stop.cmd`；还不行就拔插蓝牙接收器 / 重启（B5）。
