#!/usr/bin/env bash
set -euo pipefail

REPO="alexsanqp/agent-bridge"
INSTALL_DIR="${HOME}/.agent-bridge/bin"
BINARY_NAME="agent-bridge"
GITHUB_API="https://api.github.com/repos/${REPO}/releases/latest"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { printf "${CYAN}info${RESET}  %s\n" "$1"; }
success() { printf "${GREEN}ok${RESET}    %s\n" "$1"; }
warn()    { printf "${YELLOW}warn${RESET}  %s\n" "$1"; }
error()   { printf "${RED}error${RESET} %s\n" "$1" >&2; exit 1; }

# --- Detect OS ---
detect_os() {
  local uname_s
  uname_s="$(uname -s)"
  case "${uname_s}" in
    Darwin) echo "darwin" ;;
    Linux)  echo "linux" ;;
    *)      error "Unsupported operating system: ${uname_s}. Only macOS and Linux are supported." ;;
  esac
}

# --- Detect Architecture ---
detect_arch() {
  local uname_m
  uname_m="$(uname -m)"
  case "${uname_m}" in
    x86_64|amd64)  echo "x64" ;;
    arm64|aarch64)  echo "arm64" ;;
    *)              error "Unsupported architecture: ${uname_m}. Only x64 and arm64 are supported." ;;
  esac
}

# --- Check for required tools ---
check_dependencies() {
  local missing=()

  if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
    missing+=("curl or wget")
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    error "Missing required tools: ${missing[*]}. Please install them and try again."
  fi
}

# --- HTTP GET helper (supports curl and wget) ---
http_get() {
  local url="$1"
  if command -v curl &>/dev/null; then
    curl -fsSL "$url"
  elif command -v wget &>/dev/null; then
    wget -qO- "$url"
  fi
}

# --- Download file helper ---
http_download() {
  local url="$1"
  local dest="$2"
  if command -v curl &>/dev/null; then
    curl -fsSL -o "$dest" "$url"
  elif command -v wget &>/dev/null; then
    wget -qO "$dest" "$url"
  fi
}

# --- Get latest release tag ---
get_latest_version() {
  local response
  response="$(http_get "$GITHUB_API")" || error "Failed to fetch latest release from GitHub API. Check your internet connection."

  local version
  version="$(printf '%s' "$response" | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"

  if [ -z "$version" ]; then
    error "Could not determine latest version from GitHub API response."
  fi

  echo "$version"
}

# --- Get download URL for asset ---
get_download_url() {
  local version="$1"
  local os="$2"
  local arch="$3"

  local asset_name="${BINARY_NAME}-${os}-${arch}"
  local response
  response="$(http_get "$GITHUB_API")" || error "Failed to fetch release info."

  local url
  url="$(printf '%s' "$response" | grep '"browser_download_url"' | grep "$asset_name" | head -1 | sed -E 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"

  if [ -z "$url" ]; then
    error "Could not find release asset '${asset_name}' in version ${version}. Available assets may not include your platform (${os}-${arch})."
  fi

  echo "$url"
}

# --- Main ---
main() {
  printf "\n${BOLD}Agent Bridge Installer${RESET}\n"
  printf "Peer collaboration bridge for AI coding agents\n\n"

  check_dependencies

  local os arch version download_url
  os="$(detect_os)"
  arch="$(detect_arch)"
  info "Detected platform: ${os}-${arch}"

  info "Fetching latest release..."
  version="$(get_latest_version)"
  success "Latest version: ${version}"

  info "Resolving download URL..."
  download_url="$(get_download_url "$version" "$os" "$arch")"

  # Create install directory
  mkdir -p "$INSTALL_DIR"

  local dest="${INSTALL_DIR}/${BINARY_NAME}"

  info "Downloading ${BINARY_NAME} ${version}..."
  http_download "$download_url" "$dest" || error "Download failed."
  success "Downloaded to ${dest}"

  # Make executable
  chmod +x "$dest"
  success "Made binary executable"

  # Verify the binary runs
  if "${dest}" --version &>/dev/null; then
    local installed_version
    installed_version="$("${dest}" --version 2>&1)"
    success "Verified: ${installed_version}"
  else
    warn "Binary downloaded but could not verify version. It may still work correctly."
  fi

  # Check if already in PATH
  printf "\n"
  if echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    success "Installation directory is already in your PATH"
  else
    warn "Installation directory is not in your PATH"
    printf "\n"
    printf "${BOLD}Add Agent Bridge to your PATH:${RESET}\n\n"

    local shell_name
    shell_name="$(basename "${SHELL:-/bin/bash}")"

    case "$shell_name" in
      zsh)
        printf "  Add this line to ${CYAN}~/.zshrc${RESET}:\n\n"
        printf "    export PATH=\"\$HOME/.agent-bridge/bin:\$PATH\"\n\n"
        printf "  Then reload your shell:\n\n"
        printf "    source ~/.zshrc\n"
        ;;
      bash)
        local rc_file="~/.bashrc"
        if [ "$os" = "darwin" ]; then
          rc_file="~/.bash_profile"
        fi
        printf "  Add this line to ${CYAN}${rc_file}${RESET}:\n\n"
        printf "    export PATH=\"\$HOME/.agent-bridge/bin:\$PATH\"\n\n"
        printf "  Then reload your shell:\n\n"
        printf "    source ${rc_file}\n"
        ;;
      fish)
        printf "  Add this line to ${CYAN}~/.config/fish/config.fish${RESET}:\n\n"
        printf "    set -gx PATH \$HOME/.agent-bridge/bin \$PATH\n\n"
        printf "  Then reload your shell:\n\n"
        printf "    source ~/.config/fish/config.fish\n"
        ;;
      *)
        printf "  Add this to your shell profile:\n\n"
        printf "    export PATH=\"\$HOME/.agent-bridge/bin:\$PATH\"\n\n"
        printf "  Then restart your shell.\n"
        ;;
    esac
  fi

  printf "\n${GREEN}${BOLD}Installation complete!${RESET}\n\n"
  printf "  Run ${CYAN}agent-bridge --help${RESET} to get started.\n"
  printf "  Run ${CYAN}agent-bridge init${RESET} in a project to set up collaboration.\n\n"
}

main "$@"
