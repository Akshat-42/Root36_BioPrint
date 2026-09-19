"""
BioPrint Behavioral Authentication Engine - Database Configuration
Thread-safe SQLite database session management via SQLAlchemy.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = "sqlite:///./bioprint.db"

# SQLite requires connect_args check_same_thread: False for multi-threaded FastAPI handlers
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency yielding a SQLAlchemy session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Creates all database tables."""
    Base.metadata.create_all(bind=engine)
