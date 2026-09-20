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
    from sqlalchemy import text
    with engine.connect() as conn:
        # 1. Ensure password_hash exists in users
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN password_hash VARCHAR(256) DEFAULT ''"))
            conn.commit()
        except Exception:
            pass

        # Ensure password_valid exists in verification_logs
        try:
            conn.execute(text("ALTER TABLE verification_logs ADD COLUMN password_valid BOOLEAN DEFAULT 0"))
            conn.commit()
        except Exception:
            pass

        # 2. Check and clean up baseline_profiles (remove cognitive_baseline_json, keystroke_baseline_json, ensemble_model_json)
        try:
            res = conn.execute(text("PRAGMA table_info(baseline_profiles)")).fetchall()
            cols = [r[1] for r in res]
            if "cognitive_baseline_json" in cols or "keystroke_baseline_json" in cols or "ensemble_model_json" in cols:
                # Recreate baseline_profiles table to completely purge NOT NULL / legacy cognitive column constraints
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS baseline_profiles_clean (
                        id INTEGER PRIMARY KEY,
                        user_id VARCHAR(64) UNIQUE NOT NULL,
                        typing_baseline_json TEXT NOT NULL DEFAULT '{}',
                        motor_baseline_json TEXT NOT NULL DEFAULT '{}',
                        updated_at DATETIME,
                        FOREIGN KEY(user_id) REFERENCES users(user_id)
                    );
                """))
                # Copy over persistent user baselines
                conn.execute(text("""
                    INSERT OR IGNORE INTO baseline_profiles_clean (id, user_id, typing_baseline_json, motor_baseline_json, updated_at)
                    SELECT id, user_id, 
                           COALESCE(typing_baseline_json, '{}'), 
                           COALESCE(motor_baseline_json, '{}'), 
                           updated_at 
                    FROM baseline_profiles;
                """))
                conn.execute(text("DROP TABLE baseline_profiles;"))
                conn.execute(text("ALTER TABLE baseline_profiles_clean RENAME TO baseline_profiles;"))
                conn.commit()
        except Exception:
            pass

        # 3. Check users table for legacy passphrase column and drop it
        try:
            res = conn.execute(text("PRAGMA table_info(users)")).fetchall()
            cols = [r[1] for r in res]
            if "passphrase" in cols:
                try:
                    conn.execute(text("ALTER TABLE users DROP COLUMN passphrase"))
                    conn.commit()
                except Exception:
                    pass
        except Exception:
            pass

    Base.metadata.create_all(bind=engine)
