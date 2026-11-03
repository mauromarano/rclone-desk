#!/usr/bin/env sh
set -eu

output=${1:?usage: collect-go-licenses.sh OUTPUT_DIR}
go_root=$(go env GOROOT)
mkdir -p "$output/Go-Standard-Library"
cp "$go_root/LICENSE" "$output/Go-Standard-Library/LICENSE"
printf 'Third-party Go module license files linked into the rclone binary:\n\n' > "$output/INDEX.md"

go list -deps -f '{{if .Module}}{{.Module.Path}}|{{.Module.Version}}|{{.Module.Dir}}{{end}}' . \
  | LC_ALL=C sort -u \
  | while IFS='|' read -r module version module_dir; do
      [ -n "$module" ] || continue
      safe_module=$(printf '%s' "$module" | tr '/:@' '___')
      destination="$output/${safe_module}@${version}"
      mkdir -p "$destination"
      license_files=$(find "$module_dir" -maxdepth 1 -type f \
        \( -iname 'license*' -o -iname 'copying*' -o -iname 'notice*' -o -iname 'copyright*' \) \
        -printf '%f ' | LC_ALL=C sort)
      if [ -n "$license_files" ]; then
        find "$module_dir" -maxdepth 1 -type f \
          \( -iname 'license*' -o -iname 'copying*' -o -iname 'notice*' -o -iname 'copyright*' \) \
          -exec cp '{}' "$destination/" \;
      else
        license_files='no root license file found'
      fi
      printf -- '- %s %s: %s\n' "$module" "$version" "$license_files" >> "$output/INDEX.md"
    done

vendor_dir="$go_root/src/vendor"
if [ -d "$vendor_dir" ]; then
  printf '\nGo standard-library vendored license files:\n\n' >> "$output/INDEX.md"
  find "$vendor_dir" -type f \
    \( -iname 'license*' -o -iname 'copying*' -o -iname 'notice*' -o -iname 'copyright*' \) \
    -print | LC_ALL=C sort | while IFS= read -r source; do
      relative=${source#"$vendor_dir"/}
      relative_dir=${relative%/*}
      destination="$output/Go-Standard-Library/vendor/$relative_dir"
      mkdir -p "$destination"
      cp "$source" "$destination/"
      printf -- '- %s\n' "$relative" >> "$output/INDEX.md"
    done
fi
