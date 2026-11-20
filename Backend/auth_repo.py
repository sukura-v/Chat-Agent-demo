"""Password hashing helpers — same interface as repositories/auth_repo.py.

The parent system uses bcrypt; the demo ships a PBKDF2-SHA256 implementation
so no compiled dependency is required. Credentials are demo-only (the demo
login endpoint does not verify passwords), but the storage format stays a
salted hash — never plain text.
"""

from __future__ import annotations

import hashlib
import os


def get_password_hash(password: str) -> str:
    salt = os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode(), 100_000)
    return f"pbkdf2_sha256$100000${salt}${digest.hex()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        scheme, rounds, salt, digest = hashed_password.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256", plain_password.encode("utf-8"), salt.encode(), int(rounds)
        )
        return candidate.hex() == digest
    except (ValueError, AttributeError):
        return False
