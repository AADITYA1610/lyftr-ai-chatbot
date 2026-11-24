import sqlite3
from contextlib import contextmanager
from pathlib import Path


def database_path(database_url: str) -> Path:
    prefix = "sqlite:///"
    if not database_url.startswith(prefix) or not database_url[len(prefix):]:
        raise ValueError("DATABASE_URL must point to a SQLite file")
    return Path(database_url[len(prefix):])


@contextmanager
def connect(path: Path):
    connection = sqlite3.connect(path)
    try:
        yield connection
    finally:
        connection.close()


def initialize_database(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    with connect(path) as connection:
        with connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    metadata TEXT,
                    created_at TEXT NOT NULL
                )
            """)
            connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_messages_session_id
                ON messages (session_id, id)
            """)