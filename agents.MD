# Antigravity Workspace Rules & Token Constraints

## Token Conservation Directives
- **No Speculative Code Scanning**: Never use recursive tools to read files or scan deep directories unless explicitly targeted using absolute paths. 
- **Terse Outputs Only**: Omit explanations, pleasantries, summaries, or post-execution commentary. Provide only the direct terminal commands or file changes needed.
- **No Redundant Content Pushes**: Do not print or output whole blocks of unchanged code. Use exact git-diff lines or surgical search-and-replace syntax blocks to minimize context window inflation.

## Agent Loop Controls
- **Single-Action Rule**: Execute a maximum of 2 terminal commands or file edits per agent step. Do not execute open-ended loops without a human review checkpoint.
- **Planning Mode Boundary**: For complex logic or architecture overhauls, strictly switch to Planning Mode. Output a `working.md` breakdown first. Stop and wait for user approval before writing any code.
- **Crash Prevention**: If a command throws an error twice in a row, stop immediately. Do not repeatedly prompt yourself or spin in a loop attempting to fix it automatically.

## Context Reduction & Tooling
- **Targeted References**: Only open or reference workspace paths explicitly passed to you. Do not inject wide context schemas or irrelevant file trees into the active loop.
- **Whitelisted Actions**: You are allowed to run `npm test`, `git status`, or language-specific builds automatically. You must pause and prompt for permission before attempting any deployment or structural deletions.

## Agent skills

Matt Pocock's engineering and productivity skills are installed in `.agents/skills/`. Read the relevant `SKILL.md` when invoking one; user-invoked workflows run when requested. Installation provenance is in `.agents/matt-pocock-skills.json`.

### Issue tracker

Track work in GitHub Issues at `Yrdly-ng/yrdly-app`. Before reading or publishing tickets, read `docs/agents/issue-tracker.md` and use explicit `--repo Yrdly-ng/yrdly-app` arguments.

### Triage labels

Use the default five triage roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. Before triaging, read `docs/agents/triage-labels.md` for mapping and provisioning.

### Domain docs

Use a single-context layout: root `GLOSSARY.md` plus `docs/adr/`. Before domain or architecture work, read `docs/agents/domain.md`. Create glossary entries and ADRs as terms and decisions are resolved.
