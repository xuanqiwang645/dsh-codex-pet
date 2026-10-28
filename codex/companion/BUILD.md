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
