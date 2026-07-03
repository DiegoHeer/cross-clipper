from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All server configuration. Every field maps to a CC_* env var."""

    model_config = SettingsConfigDict(env_prefix="CC_")

    secret_key: str  # required; reserved for future signing use
    data_dir: Path = Path("./data")
    allow_registration: bool = False
    item_max_bytes: int = 262144  # 256 KB
    tombstone_retention_days: int = 30
    token_ttl_days: int = 365
    cors_origins: str = ""  # comma-separated origins
    min_client_version: str = "0.0.0"

    @property
    def blobs_dir(self) -> Path:
        return self.data_dir / "blobs"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'db.sqlite'}"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
