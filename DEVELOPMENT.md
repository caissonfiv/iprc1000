# 换电脑继续开发

当前版本：驱动 **0.1.2**、控制面板 **0.4.0**。2026-11-12 用户已确认驱动加载、基础映射和真实设备上的 GUI 测试成功。此状态不代表所有休眠、断连、持久化或压力场景均已验证。

## 获取代码

需要 Windows x64、Git 和 Node.js 24（含 npm）。

```powershell
git clone https://github.com/caissonfiv/iprc1000.git
cd iprc1000
npm ci
npm test
```

已有本地克隆则在干净工作区运行 `git pull --ff-only`。如果本地有未提交的改动，先提交或暂存自己的工作，再拉取。

## 不装驱动也能开发 UI

```powershell
$env:IPRC_DIAGNOSTIC='1'
npm start
```

这是模拟驱动模式，状态和规则仅在内存中，不访问真实设备、不注入输入。适合在家继续修改布局和配置流程。需要真实驱动时，先退出模拟界面，再清除此环境变量：

```powershell
Remove-Item Env:IPRC_DIAGNOSTIC
```

## 构建控制工具和驱动

```powershell
.\driver\bootstrap.ps1
.\driver\bootstrap-msvc.ps1
.\driver\build-zig.ps1 -ToolchainRoot .\driver\.toolchain
node .\driver\scripts\inspect-pe.cjs .\driver\build\iprcflt.sys
node --test .\driver\tests\pe_validation.test.cjs
```

首次会下载固定版本并核对 SHA-256。产物在 `driver/build/`；配套 `iprcctl.exe` 自动复制到 `driver-bin/`。构建不会安装或加载驱动。Git 中没有本机私钥、测试证书信任状态或已安装设备配置。

换到另一台电脑，不能仅靠克隆仓库就访问内核驱动。实际设备使用需要另外准备签名驱动包并安装，参见 [驱动说明](driver/README.md)。不要复用工作电脑分配的 `oemNN.inf`，该名称由每台 Windows 分配。

## 运行和打包

在已安装驱动的电脑上，以管理员身份打开 PowerShell：

```powershell
npm start
```

```powershell
npm run dist
```

便携包位于 `dist/driver-ui/IPRC1000-Driver-win32-x64/`。保留整个目录。打包只包含驱动控制面板，不带旧 Interception/HID/注入后端。

启动 UI 只读取驱动现有配置；“应用当前按键”修改 RAM；“保存到设备”显式保存整套策略与运行模式。软件退出后驱动继续映射。普通权限会显示访问错误，不会自动改系统权限或驱动安装。

## 主要入口

| 内容 | 文件 |
|---|---|
| Electron 窗口和生命周期 | `main.js` |
| HTTP 配置服务 | `src/driver-app.js` |
| 驱动配置读写与串行操作 | `src/driver-client.js` |
| ABI 编码、扫描码和动作校验 | `src/driver-policy.js` |
| 遥控器图与编辑界面 | `ui/driver.html`、`ui/driver.js` |
| 用户态控制工具 | `driver/tools/iprcctl.c` |
| 内核输入和控制接口 | `driver/kmdf/` |
| 共用映射状态机 | `driver/core/` |
| 打包白名单 | `scripts/package-driver-ui.cjs` |
| UI 和协议回归 | `tests/driver-ui.test.js` |

下一阶段可以做组合键、配置导入导出、事件订阅及语音。当前协议 ABI 1 只支持 DROP/NATIVE/单键 TAP；新增组合键时需要同步修改协议、校验、内核队列、控制工具和 UI，不能只在界面里增加选项。
