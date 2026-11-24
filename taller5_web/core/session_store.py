"""Private strategies keyed by the digest of a per-tab browser session token."""
from contextvars import ContextVar
from hashlib import sha256
from pathlib import Path
import json
import os
import re
import sqlite3
import time

owner = ContextVar("strategy_owner", default="")
_DOCKER_DIR = Path("/var/lib/ipd-session")
if os.environ.get("IPD_SESSION_DB"):
    DB = Path(os.environ["IPD_SESSION_DB"])
elif _DOCKER_DIR.is_dir() and os.access(_DOCKER_DIR, os.W_OK):
    DB = _DOCKER_DIR / "strategies.sqlite"
else:
    DB = Path(__file__).resolve().parent.parent / ".data" / "strategies.sqlite"
TTL = 24 * 3600


def bind(token):
    valid = re.fullmatch(r"[0-9a-f]{64}", token)
    owner.set(sha256(token.encode()).hexdigest() if valid else "")


def initialize():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB) as db:
        db.execute("CREATE TABLE IF NOT EXISTS strategy (owner TEXT, id TEXT, record TEXT, expires INTEGER, PRIMARY KEY(owner,id))")
        db.execute("CREATE INDEX IF NOT EXISTS expires_idx ON strategy(expires)")


def records():
    if not owner.get():
        return []
    with sqlite3.connect(DB) as db:
        rows = db.execute("SELECT record FROM strategy WHERE owner=? AND expires>? ORDER BY rowid", (owner.get(), time.time()))
        return [json.loads(row[0]) for row in rows]


def put(record):
    if not owner.get():
        raise ValueError("Abre de nuevo la página para iniciar tu sesión.")
    now = int(time.time())
    with sqlite3.connect(DB) as db:
        db.execute("DELETE FROM strategy WHERE expires <= ?", (now,))
        count, = db.execute("SELECT count(*) FROM strategy WHERE owner=?", (owner.get(),)).fetchone()
        if count >= 40:
            raise ValueError("La sesión admite hasta 40 estrategias.")
        db.execute("INSERT INTO strategy VALUES (?,?,?,?)", (owner.get(),record["id"],json.dumps(record),now+TTL))


def remove(cid):
    with sqlite3.connect(DB) as db:
        return bool(db.execute("DELETE FROM strategy WHERE owner=? AND id=?", (owner.get(),cid)).rowcount)
