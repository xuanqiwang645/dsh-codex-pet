#!/bin/bash
set -euo pipefail

# Native Codex pet installer. No runtime, network access, or configuration edits.
pet_id='dsh-whale-maid'
script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
codex_dir="${CODEX_HOME:-$HOME/.codex}"

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$codex_dir" == /* ]] || fail 'CODEX_HOME 必须是绝对路径。'
[[ -x /usr/bin/plutil ]] || fail '请在 macOS 上运行此安装器；其他系统可按 README 手动安装。'

check_manifest() {
    local manifest="$1"
    [[ -f "$manifest" && ! -L "$manifest" ]] || return 1
    [[ "$(/usr/bin/plutil -extract id raw -o - "$manifest" 2>/dev/null)" == "$pet_id" ]] &&
    [[ "$(/usr/bin/plutil -extract spritesheetPath raw -o - "$manifest" 2>/dev/null)" == 'spritesheet.webp' ]]
}

check_manifest "$script_dir/pet.json" || fail '安装包的 pet.json 缺失或不匹配。'
[[ "$(/usr/bin/plutil -extract spriteVersionNumber raw -o - "$script_dir/pet.json" 2>/dev/null)" == 1 ]] || fail '安装包必须使用已适配的 v1 精灵图格式。'
for filename in spritesheet.webp ATTRIBUTION.md LICENSE.code; do
    [[ -s "$script_dir/$filename" && ! -L "$script_dir/$filename" ]] || fail "安装包文件缺失或无效：$filename"
done

pets_dir="$codex_dir/pets"
backup_root="$codex_dir/pets-backups"
target="$pets_dir/$pet_id"
[[ ! -L "$pets_dir" && ! -L "$backup_root" && ! -L "$target" ]] || fail '目标宠物或备份目录是符号链接，已停止以保护现有文件。'
if [[ -e "$target" ]]; then
    [[ -d "$target" ]] && check_manifest "$target/pet.json" || fail "目标位置含有非本宠物的内容，未覆盖：$target"
fi

mkdir -p "$pets_dir" "$backup_root"
stage_dir="$(mktemp -d "$pets_dir/.${pet_id}.install.XXXXXX")"
backup_path=''
committed=false
on_exit() {
    local status=$?
    if [[ "$committed" != true ]]; then
        if [[ -n "$backup_path" && -d "$backup_path" && ! -e "$target" && ! -L "$target" ]]; then
            mv "$backup_path" "$target" || printf '自动恢复失败，旧文件保存在：%s\n' "$backup_path" >&2
        fi
        printf '安装未完成。临时文件保留在：%s\n' "$stage_dir" >&2
    fi
    return "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for filename in pet.json spritesheet.webp ATTRIBUTION.md LICENSE.code; do
    cp "$script_dir/$filename" "$stage_dir/$filename"
done
check_manifest "$stage_dir/pet.json" || fail '临时安装目录校验失败。'
cmp -s "$script_dir/spritesheet.webp" "$stage_dir/spritesheet.webp" || fail '精灵图复制校验失败。'

if [[ -e "$target" ]]; then
    backup_container="$(mktemp -d "$backup_root/${pet_id}.replaced.$(date +%Y%m%d-%H%M%S).XXXXXX")"
    backup_path="$backup_container/$pet_id"
    mv "$target" "$backup_path"
fi
mv "$stage_dir" "$target"
committed=true

printf '已安装：%s\n' "$target"
[[ -z "$backup_path" ]] || printf '上一版备份：%s\n' "$backup_path"
printf '%s\n' '请打开设置 → Pets/宠物 → Refresh/刷新，选择「DSH 鲸鱼娘」，然后使用 /pet 显示。'
