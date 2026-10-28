#!/bin/bash
set -euo pipefail

app_name='DSH Codex Pet.app'
bundle_id='com.xuanqi.dsh-codex-pet'
apps_root="${DSH_PET_INSTALL_ROOT:-$HOME/Applications}"
support_root="${DSH_PET_SUPPORT_ROOT:-$HOME/Library/Application Support/DSH Codex Pet}"
backup_root="$support_root/backups"
target_app="$apps_root/$app_name"

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ -x /usr/bin/plutil ]] || fail '此卸载器需要 macOS。'
[[ "$apps_root" == /* && "$support_root" == /* ]] || fail '安装目录和数据目录必须为绝对路径。'
for folder in "$apps_root" "$support_root" "$backup_root" "$target_app"; do
    [[ ! -L "$folder" ]] || fail "为保护现有内容，不处理符号链接目标：$folder"
done
if [[ ! -e "$target_app" ]]; then
    printf '未找到已安装的桌宠：%s\n' "$target_app"
    exit 0
fi
[[ -d "$target_app" && -f "$target_app/Contents/Info.plist" && ! -L "$target_app/Contents/Info.plist" ]] || fail '目标无法确认为此桌宠应用，未更改。'
[[ "$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$target_app/Contents/Info.plist" 2>/dev/null)" == "$bundle_id" ]] || fail '应用标识不匹配，未更改。'
if /bin/ps -axww -o command= | /usr/bin/awk -v prefix="$target_app/Contents/MacOS/" 'index($0,prefix)==1 { found=1 } END { exit !found }'; then
    fail '此桌宠正在运行。请从桌宠或托盘菜单选择「退出」，再重新卸载。'
fi

mkdir -p "$backup_root"
backup_container="$(mktemp -d "$backup_root/uninstalled.$(date -u +%Y%m%d-%H%M%S)UTC.XXXXXX")"
backup_app="$backup_container/$app_name"
mv "$target_app" "$backup_app"
printf '已卸载并保留应用备份：%s\n' "$backup_app"
printf '宠物数据仍保留在：%s/data\n' "$support_root"
printf '%s\n' '原生 Codex 宠物、Codex 登录与配置、原版 DSH 数据均未改动。'
