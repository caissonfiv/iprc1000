# IPRC1000 KMDF keyboard filter — candidate 0.1.2

> 实机进展：0.1.0 已测试签名并安装到目标设备，但加载失败（Code 39 / 0xC0000018）。0.1.1 实机加载失败（Code 37 / 0xC000000D）。已确认其编译缺少 KMDF 版本宏，已签名 SYS 的最低框架版本错误地写为 0xFFFFFFFF。0.1.2 显式指定 KMDF 1.33/最低 33，加入编译保护和 WDF_BIND_INFO2 二进制回归检查；用户已确认 0.1.2 实机加载、connected=1 和按键映射成功，随后确认驱动 UI 测试成功。

这是已实际编译的专用按键驱动原型，目标为 **Windows 11 x64，build 22621 或以上，KMDF 1.33**。本轮未安装、加载驱动或更改启动设置。它已通过目标设备的基础加载、测试签名部署和映射验证，尚未完成 Driver Verifier、睡眠恢复或完整压力验证，仍是实验驱动。

## 已实现

- 设备专用 Extension INF，附着到 HID 键盘功能驱动上方；不替换 Windows HID 驱动、不设置全局键盘类 UpperFilters。
- AddDevice 二次检查 Keyboard 类与同一硬件 ID 中的 VID 0A5C、PID 8502，拒绝旁系设备、串号巧合或 PID 前缀匹配。
- 在内核里屏蔽原始字符和幽灵键。默认动作：方向/OK 原生，音量/静音/播放转换为标准扩展扫描码，其余不执行。
- 媒体控制及自定义单键采用完整 tap（down/up）输出，设备漏发 up 不会直接留下映射键的按下状态。方向键原生行为继续依赖设备本身的报文。
- 重复 down 刷新 12 秒保持期；不发 up 的 6 秒固件重发只触发一次映射。同一物理按压在配置变化时保持原路由。
- 固定大小的非分页输出队列；上层只接收一部分时保留余下事件，定时重试，包括剩余的 up。队列满时不提交新的输入状态，也不宣称已经消费原始输入。
- 独立管理员控制通道（raw PDO + METHOD_BUFFERED IOCTL）；查询状态、应用策略、显式保存到当前设备注册表。配置工具退出后，已启用的基础映射继续由驱动执行。
- 睡眠时停重试定时器，保留未交付队列，恢复后继续。该生命周期实现已编译，真实电源流程尚待验证。

**首次加载默认 Observe 透传模式，不会立即吞键。** 用控制工具明确 enable 才启用映射；如未加 `--persist`，设备重新枚举后回到 Observe。保存的策略会在重新枚举时恢复，损坏/不兼容策略退回 Observe。

当前原型支持 DROP、NATIVE 和单键 TAP。组合键、剪贴板、应用专属行为、语音识别和音频采集尚未迁移；未接入现有 Electron 配置界面，也未使用 VHF。音频仍属于独立的下一阶段。

## 工程结构

```
shared/iprc_protocol.h     固定长度、无指针的用户态/内核 ABI
core/iprc_core.c           真实驱动与宿主测试共用的映射/排队代码
kmdf/iprcflt.c            设备身份校验、键盘回调、输出重试、电源回调
kmdf/control.c            raw PDO、管理员权限、配置读写
tools/iprcctl.c           用户态控制与只读硬件发现工具
package/iprcflt.inf.in    精确设备 ID 的 Extension INF 模板
tests/core_test.c         宿主 C 测试，不加载内核驱动
scripts/inspect-pe.cjs    检查内核 PE、依赖、栈保护、校验和
```

键盘回调使用 `IOCTL_INTERNAL_KEYBOARD_CONNECT`，未带入 PS/2 初始化或 ISR 钩子。没有通用键盘/鼠标拦截逻辑，没有依赖应用线程的收键循环。Core 不分配内存、不等待、不调用用户态 API；KMDF 外层负责自旋锁、PnP 和设备生命周期。

## 可复现构建

工具版本固定并校验 SHA-256：微软 CL/LINK 14.44.35230、WDK/SDK NuGet 10.0.26100.6584；Zig 0.15.2 仅编译用户态控制工具和宿主 C 测试。脚本只在指定目录下载/解压，不运行系统安装器。请遵循微软工具及 SDK/WDK 许可；仓库不分发开发套件。

```powershell
# 在仓库根目录运行；下载较大，仅首次需要。
.\driver\bootstrap.ps1 -ToolchainRoot .\driver\.toolchain
.\driver\bootstrap-msvc.ps1 -ToolchainRoot .\driver\.toolchain
.\driver\build-zig.ps1 -ToolchainRoot .\driver\.toolchain
node .\driver\scripts\inspect-pe.cjs .\driver\build\iprcflt.sys
node --test .\driver\tests\pe_validation.test.cjs
```

产物在 `driver/build/`：`iprcflt.sys`、`iprcctl.exe`、符号和宿主测试。保留旧的 build-zig.ps1 命令入口，其内部现在调用 build-msvc.ps1 编译/链接内核；Zig 不再生成内核对象或驱动映像。开启栈 cookie、NX、ASLR、CFG 和强制完整性标志，无用户态 CRT 依赖。**编译成功、结构检查或用户态映像映射不等于已证明内核加载或 HVCI 兼容。**

## 当前验证结果

- 真实共享 C 核心通过 80,253 次检查，其中包括 20,000 轮 tap 压力循环；覆盖身份误匹配、协议验证、漏发 up、6 秒重发、TTL、改配置配对、队列满与部分交付。
- `iprcflt.sys` 已实际编译/链接为 x64 Native PE；校验和、栈 cookie、页对齐、禁止可写可执行节、仅 `ntoskrnl.exe`/`WDFLDR.SYS` 依赖检查通过。
- 示例硬件 ID 生成的 Extension INF 通过微软 InfVerif `/w` 检查。这验证模板语法，不证明已确认目标蓝牙设备的匹配/层叠顺序。
- 0.1.0 已由用户安装到真实遥控器，签名验证通过，但加载出现 Code 39 / 0xC0000018，控制接口未创建。0.1.1 的 9 项严格 PE 测试、本机 10 个命名内核导入核对和本地测试签名验证通过；0.1.1 已确认 Code 37 / 0xC000000D；0.1.2 修正 KMDF 编译版本后已实机成功。任何用户态映像映射成功都不能替代该步骤。

## 真机验证前准备

先在可恢复的 Windows 测试机上验证。首次加载和签名部署会改变内核设备栈，应先确认真实硬件 ID、签名与恢复方案；本包不会自动做这些操作。

1. 唤醒/连接遥控器，运行 `driver/build/iprcctl.exe inventory`。保存实际 Keyboard 设备的完整 HardwareId，勿把实例路径或虚构的示例 ID 当成 HardwareId。
2. 用实际 ID 生成包：

   ```powershell
   .\driver\scripts\prepare-package.ps1 -HardwareId '这里替换为 inventory 输出的完整硬件 ID'
   ```

3. 对生成包运行 WDK InfVerif，并生成 catalog、执行测试签名和测试机部署。当前 `.sys` 未签名，本交付包没有可直接安装的 `.cat`。没有提供自动开启测试签名、关闭安全启动或强制安装脚本。
4. 停止原 Electron/Interception 接管程序。首次验证不叠加两套按键映射，先检查实际设备栈：应在目标 `kbdhid` 上方、`kbdclass` 输入路径内看到本过滤器。
5. 首次加载应处于 Observe，普通键盘和遥控器均透传。确认只创建目标遥控器的控制通道后，管理员运行 `iprcctl status`，再运行 `iprcctl enable` 测试。
6. 依次验证方向/OK、四个媒体动作、幽灵键、漏发 up、关闭配置进程后使用、休眠恢复、蓝牙断连和取电池重连。用 `iprcctl observe` 返回对后续按压的透传。已排队的完整事件对会继续排空，不会为了取消而遗留半个 tap。

控制命令示例（安装并加载测试签名驱动后，管理员终端）：

```cmd
iprcctl status
iprcctl enable
iprcctl map 0x32 tap 0x7c
iprcctl observe
iprcctl enable --persist
iprcctl observe --persist
```

`enable` 会应用安全内置表，`map` 只改一个规则，且不会自动从 Observe 进入 Enabled。`0x7c` 是 F13 扫描码，可供后续用户态语音服务监听。`--device N` 可选择某个控制接口，索引不保证跨重连稳定。

卸载时应移除这个设备扩展驱动包，恢复原生 `kbdhid`/`kbdclass` 路径；**不要删除设备的基础 HID 驱动或清空全局 UpperFilters**。实际部署时记录分配给本包的 `oemNN.inf`，以便只移除本包。不能把实验中的未签名文件复制到 System32 当作安装。

## 仍需验证或改进

- 已确认目标设备的真实硬件 ID、扩展 INF 匹配和 kbdclass → iprcflt → kbdhid 堆栈；其他设备隔离仍需扩大验证。
- Driver Verifier、KMDF Verifier、上层持续拥塞、移除过程中回调竞态、电源恢复。
- 队列重试机制能保留已接收数据，但不能修复低层设备本身无限丢包；原生方向键的漏发 up 仍需要实测。
- 仅靠缺失 up 的相同 down，无法保证区分“新一次真实按压”和“固件重复”；12 秒是当前折中策略。
- 策略持久化按设备，重新配对生成新设备实例时需要重新设置。
- 控制接口状态用于实验验证，Electron 配置后端已接入；事件订阅、组合键、VHF 与麦克风驱动留待后续。

## 设计依据

- [微软 HID 键盘过滤驱动指导](https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/keyboard-and-mouse-hid-client-drivers)
- [键盘连接回调接口](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/kbdmou/ni-kbdmou-ioctl_internal_keyboard_connect)
- [设备专用 AddFilter](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/inf-addfilter-directive)
- [原始子设备及侧带通道参考 Kbfiltr](https://github.com/microsoft/Windows-driver-samples/tree/main/input/kbfiltr)
- [微软 WDK NuGet](https://learn.microsoft.com/en-us/windows-hardware/drivers/install-the-wdk-using-nuget)
- [Windows 内核驱动签名政策](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/kernel-mode-code-signing-policy--windows-vista-and-later-)

实现为项目原创代码，使用 Windows 文档规定的接口；没有将 PS/2 示例驱动直接修改 ID 后当作蓝牙驱动发布。
