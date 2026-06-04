# =============================================================================
# BACKEND — Dockerfile multi-etapa
#
# Etapas:
#   builder  → instala dependencias con pip en un venv aislado
#   runtime  → imagen mínima, solo copia el venv ya construido
#
# Resultado: imagen final ~120MB vs ~800MB de una imagen naïve.
# El venv copiado entre etapas garantiza reproducibilidad exacta.
# =============================================================================

# ── Etapa 1: builder ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

# Variables de entorno que aceleran pip y evitan archivos .pyc en la imagen
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Instalar dependencias del sistema necesarias para compilar extensiones
# (asyncpg compila código C; psycopg2 necesita libpq)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Crear venv aislado — se copiará completo a la etapa runtime
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copiar solo requirements primero → Docker cachea esta capa
# si el código cambia pero requirements.txt no
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt


# ── Etapa 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    # Puerto que Railway espera por defecto
    PORT=8000

# Solo libpq en runtime (sin gcc ni herramientas de compilación)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Usuario no-root (buena práctica de seguridad en contenedores)
RUN groupadd --gid 1001 appgroup && \
    useradd  --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser

WORKDIR /app

# Copiar el venv del builder — sin recompilar nada
COPY --from=builder /opt/venv /opt/venv

# Copiar el código de la aplicación
COPY --chown=appuser:appgroup app/        ./app/
COPY --chown=appuser:appgroup alembic/    ./alembic/
COPY --chown=appuser:appgroup alembic.ini .
COPY --chown=appuser:appgroup scripts/    ./scripts/

USER appuser

# Health check que Railway usa para saber si el contenedor está listo
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

EXPOSE ${PORT}

# El entrypoint ejecuta migraciones y luego arranca el servidor
# (ver scripts/entrypoint.sh — Pilar 3)
ENTRYPOINT ["scripts/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "2", "--loop", "uvloop", "--http", "httptools"]
