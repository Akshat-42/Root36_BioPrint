"""
BioPrint Behavioral Authentication Engine - Database Configuration
Thread-safe SQLite database session management via SQLAlchemy.
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Anchor database to persistent bioprint.db in project root
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "bioprint.db")
DATABASE_URL = f"sqlite:///{DB_PATH.replace(os.sep, '/')}"

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
    """Creates all database tables and ensures schema integrity."""
    Base.metadata.create_all(bind=engine)
    # Check for missing columns in existing SQLite tables
    with engine.connect() as conn:
        try:
            conn.execute(__import__("sqlalchemy").text("ALTER TABLE users ADD COLUMN password_hash VARCHAR(256) DEFAULT ''"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(__import__("sqlalchemy").text("ALTER TABLE baseline_profiles ADD COLUMN typing_baseline_json TEXT DEFAULT '{}'"))
            conn.commit()
        except Exception:
            pass
