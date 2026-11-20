"""Bootstrap — create tables, seed demo data, start uvicorn.

Usage:
    python start.py            # http://127.0.0.1:8000  (docs at /docs)
    python start.py --port 8001
"""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Chat-Agent demo backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", help="enable autoreload")
    args = parser.parse_args()

    # 1) schema (idempotent create_all)
    from database import Base, engine
    import models  # noqa: F401  (registers all tables)

    Base.metadata.create_all(bind=engine)

    # 2) demo data (idempotent seed)
    from seed import seed_if_empty

    seed_if_empty()

    # 3) serve
    import uvicorn

    uvicorn.run(
        "app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
