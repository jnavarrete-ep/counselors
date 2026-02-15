#!/bin/bash
set -euo pipefail

REPO="aarondfrancis/counselors"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64)       ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

case "$OS" in
  darwin|linux) ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

ASSET="counselors-${OS}-${ARCH}"
CHECKSUM_ASSET="${ASSET}.sha256"
LATEST=$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)

if [ -z "$LATEST" ]; then
  echo "Failed to fetch latest release version." >&2
  exit 1
fi

BASE_URL="https://github.com/${REPO}/releases/download/${LATEST}"
URL="${BASE_URL}/${ASSET}"
CHECKSUM_URL="${BASE_URL}/${CHECKSUM_ASSET}"

TMP_BIN="$(mktemp)"
TMP_SUM="$(mktemp)"
cleanup() {
  rm -f "$TMP_BIN" "$TMP_SUM"
}
trap cleanup EXIT

mkdir -p "$INSTALL_DIR"
echo "Downloading counselors ${LATEST} (${OS}/${ARCH})..."
curl -fSL "$CHECKSUM_URL" -o "$TMP_SUM"

EXPECTED="$(awk '{print $1}' "$TMP_SUM" | tr -d '\r' | head -n 1)"
if ! [[ "$EXPECTED" =~ ^[A-Fa-f0-9]{64}$ ]]; then
  echo "Failed to parse SHA256 checksum." >&2
  exit 1
fi

curl -fSL "$URL" -o "$TMP_BIN"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TMP_BIN" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TMP_BIN" | awk '{print $1}')"
else
  echo "No SHA256 tool found (sha256sum or shasum)." >&2
  exit 1
fi

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "Checksum mismatch." >&2
  echo "Expected: $EXPECTED" >&2
  echo "Actual:   $ACTUAL" >&2
  exit 1
fi

mv "$TMP_BIN" "${INSTALL_DIR}/counselors"
chmod +x "${INSTALL_DIR}/counselors"

echo "Installed counselors to ${INSTALL_DIR}/counselors"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  echo "Note: ${INSTALL_DIR} is not in your PATH."
  echo "Add it with: export PATH=\"${INSTALL_DIR}:\$PATH\""
fi
