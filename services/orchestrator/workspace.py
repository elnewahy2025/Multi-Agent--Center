"""Git worktree and isolated workspace management."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional


class WorkspaceManager:
    """Manages Git worktrees for isolated agent task execution."""

    def __init__(self, worktrees_root: Optional[Path] = None) -> None:
        if worktrees_root is None:
            # Default to workspace/worktrees relative to project root
            self.worktrees_root = Path(__file__).resolve().parents[2] / "workspace" / "worktrees"
        else:
            self.worktrees_root = Path(worktrees_root)
        self.worktrees_root.mkdir(parents=True, exist_ok=True)

    def _sanitize_branch_name(self, raw_name: str) -> str:
        """Sanitize a task or feature name to be a valid Git branch name."""
        clean = re.sub(r"[^a-zA-Z0-9_\-\.]+", "-", raw_name).strip("-")
        return clean or "task-worktree"

    def create_worktree(
        self,
        project_root: str,
        task_id: str,
        branch_name: Optional[str] = None,
    ) -> Path:
        """Create an isolated Git worktree for an agent task."""
        project_path = Path(project_root).resolve()
        if not (project_path / ".git").exists():
            raise ValueError(f"Target directory is not a Git repository: {project_path}")

        branch = self._sanitize_branch_name(branch_name or f"agent-task-{task_id[:8]}")
        target_dir = self.worktrees_root / branch

        if target_dir.exists():
            return target_dir

        # Run git worktree add
        cmd = ["git", "worktree", "add", "-b", branch, str(target_dir)]
        res = subprocess.run(cmd, cwd=str(project_path), capture_output=True, text=True)

        if res.returncode != 0:
            # If branch already exists, check out without -b
            if "already exists" in res.stderr:
                cmd_existing = ["git", "worktree", "add", str(target_dir), branch]
                res_existing = subprocess.run(cmd_existing, cwd=str(project_path), capture_output=True, text=True)
                if res_existing.returncode != 0:
                    raise RuntimeError(f"Failed to create worktree: {res_existing.stderr.strip()}")
            else:
                raise RuntimeError(f"Failed to create worktree: {res.stderr.strip()}")

        return target_dir

    def has_uncommitted_changes(self, worktree_path: Path) -> bool:
        """Check if a worktree has uncommitted modifications."""
        if not worktree_path.exists():
            return False
        res = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(worktree_path),
            capture_output=True,
            text=True,
        )
        return bool(res.stdout.strip())

    def remove_worktree(
        self,
        project_root: str,
        worktree_path: Path,
        force: bool = False,
    ) -> bool:
        """Remove a Git worktree safely, guarding against uncommitted data loss."""
        if not worktree_path.exists():
            return True

        if not force and self.has_uncommitted_changes(worktree_path):
            raise RuntimeError(
                f"Cannot delete worktree at {worktree_path}: contains uncommitted changes. "
                "Explicit approval or force=True required."
            )

        cmd = ["git", "worktree", "remove", str(worktree_path)]
        if force:
            cmd.append("--force")

        res = subprocess.run(cmd, cwd=project_root, capture_output=True, text=True)
        return res.returncode == 0

    def get_changed_files(self, working_dir: Path) -> List[Dict[str, Any]]:
        """Inspect git status and diffs for a working directory or worktree."""
        if not working_dir.exists():
            return []

        # Run git status --porcelain
        res = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(working_dir),
            capture_output=True,
            text=True,
        )
        if res.returncode != 0:
            return []

        files: List[Dict[str, Any]] = []
        for raw_line in res.stdout.splitlines():
            if not raw_line or len(raw_line) < 4:
                continue
            status_code = raw_line[:2]
            file_path = raw_line[3:].strip()
            if file_path.startswith('"') and file_path.endswith('"'):
                file_path = file_path[1:-1]

            if "M" in status_code:
                status_name = "MODIFIED"
            elif "A" in status_code or "?" in status_code:
                status_name = "ADDED"
            elif "D" in status_code:
                status_name = "DELETED"
            else:
                status_name = "CHANGED"

            # Get file-specific diff
            diff_res = subprocess.run(
                ["git", "diff", "HEAD", "--", file_path],
                cwd=str(working_dir),
                capture_output=True,
                text=True,
            )
            file_diff = diff_res.stdout[:5000] if diff_res.returncode == 0 else ""

            # If untracked new file, show snippet of content
            if not file_diff and (working_dir / file_path).is_file():
                try:
                    with open(working_dir / file_path, "r", encoding="utf-8", errors="replace") as f:
                        file_diff = "+++ New File Preview:\n" + f.read(2000)
                except Exception:
                    pass

            files.append({
                "path": file_path,
                "status": status_name,
                "diff": file_diff or "No diff available",
            })
        return files
