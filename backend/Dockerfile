# Python FastAPI + CrewAI agent backend
# Requires Python >=3.13; uses uv for fast, reproducible installs.
FROM python:3.13-slim AS base

RUN pip install uv

WORKDIR /app
COPY pyproject.toml ./
# Install deps into the system site-packages (no venv inside container).
RUN uv pip install --system --no-cache -r pyproject.toml 2>/dev/null || \
    uv pip install --system --no-cache \
        "ag-ui-protocol>=0.1.18" \
        "crewai>=1.14.6" \
        "crewai-tools[mcp]>=1.14.6" \
        "fastapi>=0.136.3" \
        "mcp>=1.26.0" \
        "python-multipart>=0.0.29" \
        "uvicorn[standard]>=0.48.0"

COPY . .

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
