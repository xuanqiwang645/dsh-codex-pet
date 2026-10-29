# 复现构建

代码基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的提交 `2b72c1bd246e851c5e1b4890db834aba3452af43`。

1. 克隆原仓库并切换到上述提交。
2. 将本包 `source-overlay.zip` 解压覆盖到原仓库根目录。压缩包内保留 `dsh-pet/` 路径层级。
3. 在仓库的 `dsh-pet/` 包目录运行 `pnpm install --ignore-scripts --frozen-lockfile`，然后运行 `node scripts/build-codex-app.mjs`。需要 Node.js 22.12 或更新版本。
4. 准备 macOS arm64 的 Electron 43.3.0 运行时和带 Pillow 的 Python 3。运行下面命令，将路径替换为本机实际位置：

```sh
python3 build-app.py --source /路径/原仓库/dsh-pet --electron /路径/Electron.app --output /路径/安装包目录
```

`build-app.py` 在系统临时目录中组装并进行本地临时签名，随后输出 `DSH Codex Pet.app.zip`。这样可以避免同步目录给应用包重新附加 Finder 元数据。安装器只将此 ZIP 解压到个人应用目录，验证签名后替换旧版；不会清除系统隔离标记。

构建代码不读取或复制登录凭据。运行时只调用本机官方 `codex app-server`，使用现有 ChatGPT 登录；设置页不收集 API 密钥。后台自动碎碎念默认关闭。应用数据和 Chromium 配置位于个人 Application Support 下独立的 `DSH Codex Pet` 目录。

`source-overlay.zip` 包含适配源码、定向测试和共享运行时构建脚本，不包含原仓库素材副本、依赖缓存或用户数据。完整动画随已构建的应用包提供；重新构建时取自上游固定提交。

## 白龙娘动画素材

角色素材在 `dsh-pet/assets/pet-packs/chatgpt-dragon/`，透明原图、连续动作帧表和生成提示词均保留。0.4.4 的源图保留充分人物间距与边界留白；`scripts/character-layout.mjs` 根据实际 Alpha 像素识别完整人物区域，不再按等分格直接裁切。人物触边、区域切断可见部件、混入邻帧或出现未归属的显著部件时，构建会停止，要求复查区域或重新生成源图。

在包目录中运行 `node scripts/build-character-media.mjs /路径/ffmpeg --layout-only` 可检查人物区域并输出 `source/frame-layout.json`；移除 `--layout-only` 后重建视频。需要支持 libvpx-vp9 和透明 Alpha 的 FFmpeg。各组连续帧统一缩放并对齐脚底，输出 640×360 VP9-alpha 视频，桌面位移由运动驱动负责。

连续动作使用 `scripts/interpolate-character-rgba.py` 进行 48 fps 双向 DIS 光流补间，预乘 RGBA 的四个通道共享同一映射，并保留原始关键帧。脚本需要构建期 Python 及 `numpy`、`opencv-python-headless`，依赖范围见 `scripts/requirements-character-media.txt`；可用 `DSH_MEDIA_PYTHON=/路径/python` 指定解释器，缺省为 `python3`。这些 Python 库不随应用打包，安装后的桌宠只播放预先生成的视频。补间可能使细节轻微柔化。

运行 `node scripts/verify-character-media.mjs /路径/ffmpeg` 验证编码成品。它核对源关键帧的 Alpha 轮廓、补间过渡、相邻帧碎片、透明边距及边界偏差，输出角色包内的 `media-validation.json`；失败时以非零状态退出。动作顺序和 48 fps 输出计划保存在 `source/media-timeline.json`，可与原图和区域记录一同复查。

已安装素材的升级由角色包中的可信旧 SHA-256 清单限定：匹配旧内置动画的文件先备份再替换，未知哈希的动画按用户自定义保留；已有配置先备份，仅给缺少 `dragMotion` 的白龙娘实例补入默认值，其它字段和已有拖拽设置保留。稳定拖拽使用连续位置积分，保持朝向与抓取锚点，避免将取整后的窗口位置反馈到跟随计算；未启用该选项的鲸鱼娘继续使用原逻辑。
