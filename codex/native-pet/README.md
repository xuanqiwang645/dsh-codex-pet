# DSH 鲸鱼娘 · Codex 桌面宠物

将 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的鲸鱼娘动画转换为 Codex 原生本地宠物。精灵图直接取自原项目的透明动画，保留原角色。此包无需 DeepSeek Harness、Node.js、服务器或 API 密钥。

## macOS 安装

1. 解压安装包，保持文件在同一文件夹内。
2. 双击 `install.command`；也可在终端运行 `bash "/完整路径/dsh-codex-pet/install.command"`。
3. 在桌面应用中打开设置 → **Pets / 宠物**，点击 **Refresh / 刷新**，选择 **DSH 鲸鱼娘**。
4. 输入 `/pet` 或在命令菜单中选择显示宠物。不同版本的中文菜单名可能略有差异。

默认安装位置是 `~/.codex/pets/dsh-whale-maid/`。若设置了 `CODEX_HOME` 环境变量，则安装到该目录下的 `pets/dsh-whale-maid/`。刷新后仍未显示时，正常退出并重新打开桌面应用后再检查。

安装器只复制 `pet.json`、`spritesheet.webp`、`ATTRIBUTION.md` 和 `LICENSE.code`。同 ID 的上一版会移到 `~/.codex/pets-backups/`，再安装新版；其他宠物不受影响。安装器不会修改模型、API、登录配置，也不会自动切换当前宠物。

## 手动安装

把 `pet.json`、`spritesheet.webp`、`ATTRIBUTION.md` 和 `LICENSE.code` 放进同一个名为 `dsh-whale-maid` 的目录，再将该目录复制到 Codex 用户目录的 `pets/` 下。默认用户目录在 macOS/Linux 为 `~/.codex`，Windows 为 `%USERPROFILE%\.codex`；自定义了 `CODEX_HOME` 时以其值为准。

## 包含的动画

本包使用兼容的 v1 原生精灵图格式：透明 WebP，1536 × 1872，8 列 × 9 行，每格 192 × 208。包含待机、向右移动、向左移动、挥手、跳跃、失败、等待输入、工作和检查九种状态。具体触发行为由桌面应用控制。

这是原角色动画的格式适配。原插件的自主游走、喂食、余额查询、碎碎念和专属右键菜单不包含在 Codex 原生宠物格式内。此 v1 包没有 v2 的 16 方向鼠标注视动作。原视频按 Codex 固定帧数抽样，动作时长和流畅度会与原插件有所不同。

## 卸载与恢复

双击 `uninstall.command`。卸载器会将此宠物移到 `pets-backups/`，保留文件；然后在设置中刷新。恢复时，将备份内的 `dsh-whale-maid` 文件夹移回 `pets/`，确保目标位置不存在同名宠物，随后刷新。

## 来源与授权

原项目由 **PC2005-cloud** 制作：[GitHub 仓库](https://github.com/PC2005-cloud/dsh-pet)。原型「溟月」出自 [@上善无形](https://space.bilibili.com/4456176)，DeepSeek 女仆鲸鱼娘设计出自 [@ZipZipPipe](https://space.bilibili.com/4168597)。这是社区二创形象，非 DeepSeek 官方形象。

代码采用 MIT；角色与衍生动画遵循原项目声明的 **CC BY-NC-SA 4.0（署名、非商业、相同方式共享）**，不得商用。再分发时请保留署名和来源链接。完整说明见 `ATTRIBUTION.md`；代码许可证见 `LICENSE.code`。

桌面宠物功能与操作说明参考 [OpenAI 官方 Pets 文档](https://learn.chatgpt.com/docs/pets)。

## 可复现构建

本包取材于原仓库提交 `2b72c1bd246e851c5e1b4890db834aba3452af43`。`provenance.json` 记录每个状态的原视频、SHA-256、抽帧时间、镜像关系及透明度清理参数。原视频背景的 1/255 透明度残留已清除，保留原角色像素。

准备该提交的源码、支持 `libvpx-vp9` 解码的 FFmpeg，以及安装 Pillow 的 Python 3，然后运行：

```sh
python3 tools/build_pet.py --source-repo /完整路径/dsh-pet --ffmpeg /完整路径/ffmpeg
```

构建程序会生成精灵图、清单、来源记录和预览；不调用任何模型或 API。`verification/atlas-validation.json` 是最终精灵图的格式校验结果。安装器已验证首次安装、重复安装备份、卸载、带空格路径及拒绝覆盖其他内容；实际桌面显示仍需在应用中刷新并选中后确认。
