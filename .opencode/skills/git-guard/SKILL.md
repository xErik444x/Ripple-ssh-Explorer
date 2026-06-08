# Git Guard — Commit & Push Protection

Prevents accidental commits and pushes without explicit user approval.

## Behavior

Before running **any** git command that modifies remote history (`commit`, `push`, `merge`, `rebase`, `amend`, `reset --hard`, `push --force`), you **MUST**:

1. **Pause and present** to the user:
   - A summary of what files will be affected (`git diff --stat`)
   - A summary of the commit message or intent
   - The exact command you plan to run

2. **Get explicit verbal confirmation** from the user (e.g. "yes", "adelante", "dale", "hacelo") before proceeding.

3. Only after receiving confirmation, execute the command.

## Exceptions

- `git status`, `git diff`, `git log`, `git branch`, `git remote` — read-only commands, no approval needed.
- `git add`, `git restore` — staging/unstaging only, no approval needed (but you should still explain what you're doing).

## Rationale

This project has multiple contributors and a merge-based workflow. Unapproved pushes can overwrite work or introduce broken code. Always ask first.
