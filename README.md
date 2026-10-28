# DSH 鲸鱼娘 · Codex 桌面宠物

将 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 适配为 Codex 本地桌面伴侣，保留原角色、透明动画、喂食与玩耍，增加现有 Codex 登录下的聊天和真实额度查询。

![鲸鱼娘动画](dsh-pet/assets/preview/daiji-huxi-xiuxian.gif)

## 下载

| 版本 | 下载 | 用途 |
| --- | --- | --- |
| 交互版 · macOS arm64 | [下载安装包](https://github.com/xuanqiwang645/dsh-codex-pet/releases/download/codex-v0.4.0/dsh-codex-companion-0.4.0-codex.1-macos-arm64.zip) | 透明桌宠窗口、喂食、玩耍、聊天、额度、设置 |
| Codex 原生皮肤 · v1 | [下载皮肤包](https://github.com/xuanqiwang645/dsh-codex-pet/releases/download/codex-v0.4.0/dsh-native-pet-1.0.0.zip) | Codex 自带宠物界面的九种动画 |

[发布页与 SHA-256 校验文件](https://github.com/xuanqiwang645/dsh-codex-pet/releases/tag/codex-v0.4.0)

交互版二进制支持 **macOS 12 及以上、Apple Silicon（arm64）**。当前发行包使用临时签名，未经过 Apple 公证；macOS 可能要求用户手动确认打开。安装器保留隔离标记，不修改安全设置。当前没有 Intel Mac、Windows 或 Linux 的 Codex 交互版发行包。

## 安装与使用

1. 下载并解压交互版外层安装包，保留内部 `DSH Codex Pet.app.zip` 原样。
2. 双击 `install.command`，随后打开个人「应用程序」中的 **DSH Codex Pet**。
3. 右键宠物：`动作 → 吃什么` 可喂食，`动作 → 玩耍` 可点播玩耍动画；首层菜单提供对话、碎碎念、Codex 额度、设置、重载和退出。

聊天沿用本机已登录的 Codex 账号，无需另外提供 API 密钥，当前支持文字。需要支持相应 App Server 和命名权限配置的 CLI；已在 `0.164.0-alpha.11.1` 上验证。聊天使用独立只读会话，自动碎碎念默认关闭，开启后按间隔消耗正常 Codex 额度。额度显示套餐窗口的剩余百分比和重置时间。

交互版配置和聊天记忆保存在 `~/Library/Application Support/DSH Codex Pet/data/`，独立于原版 DSH 和 Codex 原生宠物。旧版更新和卸载均保留备份及用户数据。原生皮肤与交互版可以分别安装；详见 [交互版说明](codex/companion/README.md) 和 [原生皮肤说明](codex/native-pet/README.md)。

## 源码与验证

- 上游基线：`2b72c1bd246e851c5e1b4890db834aba3452af43`。
- [构建说明](codex/companion/BUILD.md)、[安装器](codex/companion/install.command)、[验证记录](codex/companion/verification/verification.json)。
- 59 项定向测试与两套 TypeScript 检查通过；已验证安装后真实聊天、吃饭播放完成、菜单和设置页，以及配置重载。
- [原项目 README](README.upstream.md) 保留了 DSH 的完整使用与素材说明。本仓库的 Codex 交互版由配套桌面程序承载；原生皮肤只提供动画，未实现 v2 的 16 方向注视。

## 来源与许可

原项目及动画制作：**[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**。原型「溟月」出自 B 站 [@上善无形](https://space.bilibili.com/4456176)，DeepSeek 女仆鲸鱼娘设计出自 [@ZipZipPipe](https://space.bilibili.com/4168597)。这是社区二创，非 DeepSeek 或 OpenAI 官方宠物。

代码采用 MIT；角色和衍生动画按原项目声明遵循 **CC BY-NC-SA 4.0：署名、非商业、相同方式共享**。再分发请保留来源和署名。详见 [来源与授权](codex/companion/ATTRIBUTION.md) 和 [原代码许可](LICENSE)。
