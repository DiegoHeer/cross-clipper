"""ASGI entrypoint for running crossclipper under uvicorn.

Usage:
    uvicorn crossclipper.asgi:app
    # or, to build from env at import time:
    uvicorn crossclipper.asgi:app --factory  (not needed — app is built here)

The `create_app` factory reads `Settings()` from environment, so set
CC_SECRET_KEY, CC_DATA_DIR, CC_ALLOW_REGISTRATION etc. before starting.
"""

from crossclipper.main import create_app

app = create_app()
