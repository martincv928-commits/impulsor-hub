#!/usr/bin/env bash
# Copia el código web de ../quoteflow hacia www/ para empaquetarlo en la app
# nativa, dejando fuera lo que no debe ir dentro de un APK/AAB público:
# el panel de administración (admin/), archivos internos de Supabase y las
# pruebas. Se corre antes de cada "npx cap sync android".
set -euo pipefail
cd "$(dirname "$0")"
rm -rf www
mkdir -p www
SRC="../quoteflow"
for item in "$SRC"/*; do
  name=$(basename "$item")
  case "$name" in
    admin|supabase|tests|README.md|package.json) continue ;;
  esac
  cp -r "$item" "www/$name"
done
echo "www/ listo (sin admin/, supabase/, tests/)"
