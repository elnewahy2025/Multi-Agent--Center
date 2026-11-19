"""Create clean distribution ZIP archive of the AI Coding Command Center."""

import zipfile
from pathlib import Path

def create_archive():
    root = Path(__file__).resolve().parent.parent
    zip_path = root / "AI-Coding-Command-Center-v1.0.0.zip"
    
    ignore_dirs = {".git", "__pycache__", ".pytest_cache", "venv", ".venv"}
    ignore_exts = {".pyc", ".pyo", ".zip"}

    print(f"Creating archive at: {zip_path.name}...")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in root.rglob("*"):
            # Skip ignored directories and files
            if any(part in ignore_dirs for part in p.parts):
                continue
            if p.suffix in ignore_exts or p.name == ".env":
                continue
            if p.is_file():
                arcname = p.relative_to(root)
                zf.write(p, arcname)

    print(f"Archive successfully generated: {zip_path.stat().st_size / 1024:.1f} KB")

if __name__ == "__main__":
    create_archive()
