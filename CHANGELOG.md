# Changelog

## [Unreleased]

### Added
- Autonomy mode: manual (default) and autonomous collaboration modes, configured via `autonomy.mode` in `config.yaml`
- `peer_check` tool for non-blocking task polling (lightweight alternative to `peer_wait`)
- Client-specific instruction files: `.cursor/rules/agent-bridge.mdc` for Cursor, `CLAUDE.md` section for Claude Code
- Roles decoupled from clients -- any role can be assigned to any client during init

### Fixed
- Artifact path resolution now uses forward slashes consistently across platforms
- CI pipeline fixes for cross-platform builds

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
