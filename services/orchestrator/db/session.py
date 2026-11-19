"""Database session management and lifecycle helper."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Generator, Optional
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from services.orchestrator.db.config import get_database_url
from services.orchestrator.db.models import Base

_engine: Optional[Engine] = None
_session_factory: Optional[sessionmaker] = None


def get_engine(db_url: Optional[str] = None) -> Engine:
    """Get or create singleton SQLAlchemy Engine."""
    global _engine
    if _engine is None or db_url is not None:
        target_url = db_url or get_database_url()
        # Enable pool_pre_ping to automatically reconnect on stale connections
        _engine = create_engine(target_url, pool_pre_ping=True)
    return _engine


def get_session_factory(db_url: Optional[str] = None) -> sessionmaker:
    """Get or create singleton session factory."""
    global _session_factory
    if _session_factory is None or db_url is not None:
        engine = get_engine(db_url)
        _session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return _session_factory


def init_db(db_url: Optional[str] = None) -> Engine:
    """Create all tables in the configured database if they do not exist."""
    engine = get_engine(db_url)
    Base.metadata.create_all(bind=engine)
    return engine


@contextmanager
def get_db_session(db_url: Optional[str] = None) -> Generator[Session, None, None]:
    """Provide a transactional database session scope."""
    factory = get_session_factory(db_url)
    session: Session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
