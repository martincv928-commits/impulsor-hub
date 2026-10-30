#!/usr/bin/env bash
# Arma www/ con la consola admin y lo compartido que necesita (estilos,
# config, capa de nube, supabase), reescribiendo las rutas "../" de la web.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf www && mkdir -p www/src www/vendor
cp -r ../quoteflow/admin/* www/
cp ../quoteflow/src/styles.css ../quoteflow/src/config.js ../quoteflow/src/cloud.js www/src/
cp ../quoteflow/vendor/supabase.umd.js www/vendor/
cp native-shim.js www/
sed -i 's#\.\./src/#src/#g; s#\.\./vendor/#vendor/#g' www/index.html www/sw.js
sed -i 's#<script src="admin.js#<script src="native-shim.js"></script>\n  <script src="admin.js#' www/index.html
echo "www/ de admin listo"
