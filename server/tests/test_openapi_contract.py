import json
from pathlib import Path

CONTRACT = Path(__file__).resolve().parents[2] / "packages" / "core" / "openapi.json"
HINT = (
    "OpenAPI contract drift — run scripts/update-api-contract.sh and commit the result"
)


def test_openapi_schema_matches_committed_contract(app):
    assert CONTRACT.exists(), f"missing {CONTRACT} — {HINT}"
    committed = json.loads(CONTRACT.read_text())
    assert app.openapi() == committed, HINT
