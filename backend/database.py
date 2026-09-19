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
    """Creates all database tables and ensures schema integrity without legacy columns."""
    import sqlite3

    # Migrate SQLite schema if legacy columns (cognitive_baseline_json, passphrase) are present
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()

            # Check baseline_profiles schema
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='baseline_profiles'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(baseline_profiles)")
                bp_cols = [row[1] for row in cursor.fetchall()]
                if "cognitive_baseline_json" in bp_cols or "keystroke_baseline_json" in bp_cols:
                    cursor.execute("""
                        CREATE TABLE IF NOT EXISTS baseline_profiles_v2 (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            user_id VARCHAR(64) NOT NULL UNIQUE,
                            typing_baseline_json TEXT NOT NULL,
                            motor_baseline_json TEXT NOT NULL,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY(user_id) REFERENCES users (user_id)
                        )
                    """)
                    cursor.execute("""
                        INSERT OR IGNORE INTO baseline_profiles_v2 (id, user_id, typing_baseline_json, motor_baseline_json, updated_at)
                        SELECT id, user_id, 
                               COALESCE(typing_baseline_json, keystroke_baseline_json, '{}'),
                               COALESCE(motor_baseline_json, '{}'),
                               updated_at
                        FROM baseline_profiles
                    """)
                    cursor.execute("DROP TABLE baseline_profiles")
                    cursor.execute("ALTER TABLE baseline_profiles_v2 RENAME TO baseline_profiles")
                    conn.commit()

            # Check users schema
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
            if cursor.fetchone():
                cursor.execute("PRAGMA table_info(users)")
                u_cols = [row[1] for row in cursor.fetchall()]
                if "passphrase" in u_cols:
                    cursor.execute("""
                        CREATE TABLE IF NOT EXISTS users_v2 (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            user_id VARCHAR(64) NOT NULL UNIQUE,
                            password_hash VARCHAR(256) NOT NULL DEFAULT '',
                            sample_count INTEGER DEFAULT 1,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    """)
                    cursor.execute("""
                        INSERT OR IGNORE INTO users_v2 (id, user_id, password_hash, sample_count, created_at, updated_at)
                        SELECT id, user_id, COALESCE(password_hash, passphrase, ''), sample_count, created_at, updated_at
                        FROM users
                    """)
                    cursor.execute("DROP TABLE users")
                    cursor.execute("ALTER TABLE users_v2 RENAME TO users")
                    conn.commit()

            conn.close()
        except Exception as e:
            print(f"[BioPrint DB Migration] {e}")

    Base.metadata.create_all(bind=engine)
