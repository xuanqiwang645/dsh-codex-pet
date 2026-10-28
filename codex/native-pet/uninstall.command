#!/bin/bash
set -euo pipefail

pet_id='dsh-whale-maid'
codex_dir="${CODEX_HOME:-$HOME/.codex}"
fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$codex_dir" == /* ]] || fail 'CODEX_HOME 必须是绝对路径。'
[[ -x /usr/bin/plutil ]] || fail '请在 macOS 上运行此卸载器；其他系统可手动移走宠物目录。'

pets_dir="$codex_dir/pets"
backup_root="$codex_dir/pets-backups"
target="$pets_dir/$pet_id"
[[ ! -L "$pets_dir" && ! -L "$backup_root" && ! -L "$target" ]] || fail '目标宠物或备份目录是符号链接，未更改。'
if [[ ! -e "$target" ]]; then
    printf '未找到已安装的 DSH 鲸鱼娘：%s\n' "$target"
    exit 0
fi
[[ -d "$target" && -f "$target/pet.json" && ! -L "$target/pet.json" ]] || fail '目标目录无法确认为本宠物，未更改。'
[[ "$(/usr/bin/plutil -extract id raw -o - "$target/pet.json" 2>/dev/null)" == "$pet_id" ]] || fail '宠物 ID 不匹配，未更改。'

mkdir -p "$backup_root"
backup_container="$(mktemp -d "$backup_root/${pet_id}.uninstalled.$(date +%Y%m%d-%H%M%S).XXXXXX")"
backup_path="$backup_container/$pet_id"
mv "$target" "$backup_path"
printf '已卸载并保留备份：%s\n' "$backup_path"
printf '%s\n' '请在宠物设置中刷新列表；如需恢复，将备份中的 dsh-whale-maid 文件夹移回 pets 目录。'
