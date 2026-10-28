#!/bin/bash
set -euo pipefail

# Install this companion only. Keep user data and the Codex native pet intact.
app_name='DSH Codex Pet.app'
bundle_id='com.xuanqi.dsh-codex-pet'
script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_app="$script_dir/$app_name"
payload_zip="$script_dir/$app_name.zip"
apps_root="${DSH_PET_INSTALL_ROOT:-$HOME/Applications}"
support_root="${DSH_PET_SUPPORT_ROOT:-$HOME/Library/Application Support/DSH Codex Pet}"
backup_root="$support_root/backups"
target_app="$apps_root/$app_name"

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ -x /usr/bin/plutil && -x /usr/bin/ditto && -x /usr/bin/zipinfo && -x /usr/bin/codesign ]] || fail '此安装器需要 macOS。'
[[ "$apps_root" == /* && "$support_root" == /* ]] || fail '安装目录和数据目录必须为绝对路径。'

check_bundle() {
    local bundle="$1" executable
    [[ -d "$bundle" && ! -L "$bundle" && -f "$bundle/Contents/Info.plist" && ! -L "$bundle/Contents/Info.plist" ]] || return 1
    [[ "$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$bundle/Contents/Info.plist" 2>/dev/null)" == "$bundle_id" ]] || return 1
    executable="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$bundle/Contents/Info.plist" 2>/dev/null)" || return 1
    [[ -n "$executable" && "$executable" != */* && "$executable" != '.' && "$executable" != '..' ]] || return 1
    [[ -f "$bundle/Contents/MacOS/$executable" && -x "$bundle/Contents/MacOS/$executable" && ! -L "$bundle/Contents/MacOS/$executable" ]]
}

is_running() {
    /bin/ps -axww -o command= | /usr/bin/awk -v prefix="$target_app/Contents/MacOS/" 'index($0,prefix)==1 { found=1 } END { exit !found }'
}

payload_mode='app'
if [[ -e "$payload_zip" || -L "$payload_zip" ]]; then
    [[ -f "$payload_zip" && -s "$payload_zip" && ! -L "$payload_zip" ]] || fail '应用 ZIP 缺失、为空或是符号链接。'
    payload_mode='zip'
else
    check_bundle "$source_app" || fail "安装包内缺少 $app_name.zip 或有效的 $app_name。"
fi
for folder in "$apps_root" "$support_root" "$backup_root" "$target_app"; do
    [[ ! -L "$folder" ]] || fail "为保护现有内容，不处理符号链接目标：$folder"
done
if [[ -e "$target_app" ]]; then
    check_bundle "$target_app" || fail "目标位置不是此桌宠应用，未覆盖：$target_app"
    if is_running; then
        fail '此桌宠正在运行。请从桌宠或托盘菜单选择「退出」，再重新安装。'
    fi
fi

mkdir -p "$apps_root" "$backup_root"
stage_dir="$(mktemp -d "$apps_root/.dsh-codex-pet.install.XXXXXX")"
stage_app="$stage_dir/$app_name"
backup_app=''
committed=false
on_exit() {
    local status=$?
    if [[ "$committed" != true ]]; then
        if [[ -n "$backup_app" && -d "$backup_app" && ! -e "$target_app" && ! -L "$target_app" ]]; then
            mv "$backup_app" "$target_app" || printf '自动恢复未完成，旧版保存在：%s\n' "$backup_app" >&2
        fi
        printf '安装未完成。临时文件保留在：%s\n' "$stage_dir" >&2
    fi
    return "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ZIP stays intact in synced Documents; signed app files are extracted directly
# under Applications so Finder does not reattach disallowed resource metadata.
if [[ "$payload_mode" == 'zip' ]]; then
    members="$stage_dir/archive-members.txt"
    /usr/bin/zipinfo -1 "$payload_zip" > "$members" || fail '无法读取应用 ZIP。'
    [[ -s "$members" ]] || fail '应用 ZIP 是空的。'
    while IFS= read -r member; do
        [[ "$member" == "$app_name" || "$member" == "$app_name/"* ]] || fail '应用 ZIP 含有意外的顶层路径。'
        case "$member" in
            /*|..|../*|*/../*|*/..|*\\*) fail '应用 ZIP 含有不安全的路径。' ;;
        esac
    done < "$members"
    # Electron's framework links only point forward within the bundle. Refuse
    # absolute/parent-traversing links before extracting any archive contents.
    links="$stage_dir/archive-links.txt"
    LC_ALL=C /usr/bin/zipinfo -l "$payload_zip" | LC_ALL=C /usr/bin/awk '/^l/ { for (i=1;i<=9;i++) sub(/^[^[:space:]]+[[:space:]]+/, ""); print }' > "$links" || fail '无法检查应用 ZIP 的链接。'
    while IFS= read -r member; do
        [[ -n "$member" ]] || continue
        link_target="$(/usr/bin/unzip -p "$payload_zip" "$member")" || fail '无法读取应用 ZIP 的链接目标。'
        case "$link_target" in
            ''|/*|..|../*|*/../*|*/..|*\\*) fail '应用 ZIP 含有越界或无效的链接。' ;;
        esac
    done < "$links"
    /usr/bin/ditto -x -k "$payload_zip" "$stage_dir"
else
    # Preserve the direct bundle's signatures and existing quarantine state.
    /usr/bin/ditto "$source_app" "$stage_app"
fi
check_bundle "$stage_app" || fail '复制后的应用结构校验失败。'
/usr/bin/codesign --verify --deep --strict "$stage_app" || fail '应用签名或完整性校验失败，未替换已安装版本。'
if [[ "$payload_mode" == 'app' ]]; then
    cmp -s "$source_app/Contents/Info.plist" "$stage_app/Contents/Info.plist" || fail '应用清单复制校验失败。'
    executable="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$source_app/Contents/Info.plist")"
    cmp -s "$source_app/Contents/MacOS/$executable" "$stage_app/Contents/MacOS/$executable" || fail '应用程序复制校验失败。'
fi

if [[ -e "$target_app" ]]; then
    backup_container="$(mktemp -d "$backup_root/replaced.$(date -u +%Y%m%d-%H%M%S)UTC.XXXXXX")"
    backup_app="$backup_container/$app_name"
    mv "$target_app" "$backup_app"
fi
mv "$stage_app" "$target_app"
if [[ "$payload_mode" == 'zip' ]]; then
    # Only these installer-authored plain-text inventories are removed.
    /bin/rm "$members" "$links"
fi
rmdir "$stage_dir"
committed=true

printf '已安装：%s\n' "$target_app"
[[ -z "$backup_app" ]] || printf '上一版备份：%s\n' "$backup_app"
printf '%s\n' '双击「DSH Codex Pet」启动；右键桌宠可喂食、玩耍、聊天、查询额度或退出。'
printf '数据目录：%s/data\n' "$support_root"
