"""Safe online backup utility for OpenCode SQLite database.

Uses the official SQLite Online Backup API to safely capture the complete
database state, including any uncheckpointed WAL (write-ahead log) transactions,
even while OpenCode Desktop is actively running.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


def backup_opencode_db() -> Path:
    """Perform an atomic online backup of opencode.db and verify its integrity."""
    home = Path.home()
    source_db_path = home / ".local" / "share" / "opencode" / "opencode.db"
    backup_dir = home / ".local" / "share" / "opencode" / "backups"

    if not source_db_path.exists():
        raise FileNotFoundError(f"Source database not found: {source_db_path}")

    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target_db_path = backup_dir / f"opencode_backup_{timestamp}.db"

    print(f"Source database: {source_db_path}")
    print(f"Target backup:   {target_db_path}")
    print("Initiating atomic SQLite online backup...")

    # Connect to source in read-only mode to prevent any write interference
    source_uri = f"{source_db_path.as_uri()}?mode=ro"
    src_conn = sqlite3.connect(source_uri, uri=True)
    dst_conn = sqlite3.connect(target_db_path)

    try:
        # SQLite backup API handles WAL merging transparently
        src_conn.backup(dst_conn)
        print("Online backup transfer completed successfully.")
    finally:
        dst_conn.close()
        src_conn.close()

    # Independent integrity verification on the backup file
    print("Verifying backup integrity...")
    backup_uri = f"{target_db_path.as_uri()}?mode=ro"
    verify_conn = sqlite3.connect(backup_uri, uri=True)
    try:
        cursor = verify_conn.cursor()
        cursor.execute("PRAGMA quick_check;")
        check_result = cursor.fetchall()
        print(f"PRAGMA quick_check: {check_result}")
        if check_result != [("ok",)]:
            raise RuntimeError(f"Integrity check failed: {check_result}")

        cursor.execute("SELECT count(*) FROM session_v2;")
        sessions_count = cursor.fetchone()[0]
        cursor.execute("SELECT count(*) FROM session_message;")
        messages_count = cursor.fetchone()[0]
        cursor.execute("SELECT count(*) FROM project;")
        projects_count = cursor.fetchone()[0]

        print(f"Verified Records in Backup:")
        print(f"  - Projects:         {projects_count}")
        print(f"  - Sessions:         {sessions_count}")
        print(f"  - Session messages: {messages_count}")
        print(f"Backup file size:     {target_db_path.stat().st_size:,} bytes")
    finally:
        verify_conn.close()

    return target_db_path


if __name__ == "__main__":
    try:
        backup_path = backup_opencode_db()
        print(f"\nSUCCESS: Verified backup created at:\n{backup_path}")
    except Exception as exc:
        print(f"\nERROR: Backup failed: {exc}", file=sys.stderr)
        sys.exit(1)
