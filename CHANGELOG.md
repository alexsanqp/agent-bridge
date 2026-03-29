# Changelog

## [0.2.0] - 2026-03-29

### Added
- Autonomy mode: `--mode manual` (default) and `--mode autonomous` flag for init
- `peer_check` tool for non-blocking task polling (lightweight alternative to `peer_wait`)
- Client-specific instruction files: `.cursor/rules/agent-bridge.mdc` for Cursor, `CLAUDE.md` section for Claude Code
- Roles decoupled from clients -- any role can be assigned to any client during init
- Cursor detection via binary in PATH (not only `.cursor/` directory)
- Interactive role prompting during init for each detected client

### Fixed
- Artifact path resolution relative to project root, not CWD
- CI pipeline: public npm registry, polling test hangs on macOS
- npm publishing with OIDC trusted publishing + Granular Token fallback

## [0.1.0] - 2026-03-28

### Added
- MCP stdio server with 8 peer collaboration tools
- SQLite WAL mode shared database
- CLI: init, doctor, status, tasks, reset, self-update, version
- Client detection: Cursor, Claude Code, Codex CLI
- MCP config generation for all three clients
- Role prompt and AGENTS.md generation
- Security policies: file blocking, size limits, path boundary
- Cross-platform support: macOS, Linux, Windows
- GitHub Actions CI/CD pipeline
- Install scripts for curl (macOS/Linux) and PowerShell (Windows)
