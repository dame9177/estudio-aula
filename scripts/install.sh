#!/usr/bin/env bash
# Installs dependencies and adds "Estúdio de Aula" to the GNOME app grid (no sudo needed).
#   ./scripts/install.sh            install / update
#   ./scripts/install.sh --remover  remove the menu entry and icons
set -euo pipefail
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
DESKTOP="$APPS/estudio-aula.desktop"

if [ "${1:-}" = "--remover" ]; then
  rm -f "$DESKTOP" "$ICONS/512x512/apps/estudio-aula.png" "$ICONS/scalable/apps/estudio-aula.svg"
  update-desktop-database "$APPS" 2>/dev/null || true
  gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true
  echo "Estúdio de Aula removido do menu. (Os vídeos em ~/Vídeos/Estúdio de Aula continuam lá.)"
  exit 0
fi

cd "$DIR"
if ! command -v npm >/dev/null 2>&1; then
  echo "Preciso do Node.js 20 ou mais novo para instalar: https://nodejs.org/pt/download (ou via nvm)." >&2
  exit 1
fi
if [ ! -x node_modules/electron/dist/electron ] || [ ! -x node_modules/ffmpeg-static/ffmpeg ]; then
  echo "Instalando dependências (uma vez só)…"
  npm install --no-fund --no-audit
  npm rebuild ffmpeg-static electron >/dev/null
fi

install -Dm644 packaging/estudio-aula.png "$ICONS/512x512/apps/estudio-aula.png"
install -Dm644 packaging/estudio-aula.svg "$ICONS/scalable/apps/estudio-aula.svg"
mkdir -p "$APPS"
cat >"$DESKTOP" <<DESK
[Desktop Entry]
Type=Application
Name=Estúdio de Aula
GenericName=Gravador de videoaula
Comment=Grave sua aula a partir do PDF, com a câmera num cantinho
Exec="$DIR/scripts/estudio-aula" %f
Icon=estudio-aula
Terminal=false
Categories=AudioVideo;Recorder;
MimeType=application/pdf;
Keywords=aula;gravar;slides;pdf;webcam;video;
StartupNotify=true
StartupWMClass=estudio-aula
DESK
chmod 644 "$DESKTOP"
update-desktop-database "$APPS" 2>/dev/null || true
gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true
echo "Pronto! Procure por “Estúdio de Aula” nos aplicativos (tecla Super e digite “aula”)."
