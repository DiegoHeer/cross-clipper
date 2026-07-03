# ---- build: resolve deps with uv into a self-contained venv -----------------
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
# Layer-cache deps separately from source.
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY server/src ./src
RUN uv sync --frozen --no-dev

# ---- runtime: slim image, never root (system spec §7) -----------------------
FROM python:3.12-slim-bookworm
# curl: meaningful healthcheck + in-container debugging (spec §7).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=1000:1000 /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    CC_DATA_DIR=/data
USER 1000:1000
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD curl -fsS http://localhost:8080/health || exit 1
CMD ["uvicorn", "crossclipper.asgi:app", "--host", "0.0.0.0", "--port", "8080"]
