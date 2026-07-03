from crossclipper.config import Settings


def test_settings_read_cc_env_vars(monkeypatch, tmp_path):
    monkeypatch.setenv("CC_SECRET_KEY", "s3cret")
    monkeypatch.setenv("CC_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CC_ITEM_MAX_BYTES", "1024")
    s = Settings()
    assert s.secret_key == "s3cret"
    assert s.data_dir == tmp_path
    assert s.item_max_bytes == 1024
    assert s.allow_registration is False
    assert s.tombstone_retention_days == 30
    assert s.token_ttl_days == 365


def test_settings_derived_paths_and_cors(tmp_path):
    s = Settings(
        secret_key="x",
        data_dir=tmp_path,
        cors_origins="chrome-extension://abc, https://foo.example",
    )
    assert s.blobs_dir == tmp_path / "blobs"
    assert s.database_url == f"sqlite:///{tmp_path / 'db.sqlite'}"
    assert s.cors_origin_list == ["chrome-extension://abc", "https://foo.example"]
    assert Settings(secret_key="x", data_dir=tmp_path).cors_origin_list == []
