"""Print the canonical OpenAPI schema to stdout. Deterministic: sorted keys."""

import json
import sys
import tempfile
from pathlib import Path

from crossclipper.config import Settings
from crossclipper.main import create_app


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        app = create_app(Settings(secret_key="schema-dump", data_dir=Path(tmp)))
        json.dump(app.openapi(), sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
