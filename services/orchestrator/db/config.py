"""Database configuration and environment variable resolution."""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load local .env if present
env_path = Path(__file__).resolve().parents[3] / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)


def get_database_url() -> str:
    """Retrieve database connection URL from environment with fallback."""
    url = os.getenv("COMMAND_CENTER_DATABASE_URL")
    if not url:
        # Default fallback to PostgreSQL on localhost:5433
        url = "postgresql+psycopg2://postgres:Omar2009!@localhost:5433/command_center"
    return url
