# Transporte Municipal — Sistema de Gestión

Sistema multi-región para gestión de transporte público.
Backend: FastAPI + PostgreSQL/PostGIS.
Frontend: React + Tailwind + Leaflet.

## Estructura del proyecto

```
transporte-municipal/
├── backend/          # API FastAPI
│   ├── app/
│   │   ├── core/    # config, database, security, dependencies
│   │   ├── models/  # Pydantic schemas
│   │   ├── routers/ # endpoints HTTP y WebSocket
│   │   └── services/
│   ├── alembic/     # migraciones de BD
│   ├── scripts/     # entrypoint.sh
│   └── tests/
├── frontend/         # Panel de administración React
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── store/
│   │   ├── services/
│   │   ├── types/
│   │   └── config/  # regions.ts — configuración multi-región
│   └── deploy/
└── docs/
    └── schema.sql   # Schema completo de PostgreSQL
```

## Inicio rápido

### Requisitos
- Python 3.12+
- Node.js 20+
- PostgreSQL 15+ con PostGIS
- (Opcional) Docker

### 1. Base de datos

```bash
createdb transporte
psql transporte < docs/schema.sql
```

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Editar .env con tu DATABASE_URL y JWT_SECRET_KEY
uvicorn app.main:app --reload
# API disponible en http://localhost:8000
# Docs en http://localhost:8000/docs
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
# Editar VITE_API_URL si el backend no está en localhost:8000
npm run dev
# Panel en http://localhost:5173
```

## Despliegue en Railway

Ver `frontend/deploy/DEPLOY.md` para instrucciones completas.

```bash
npm install -g @railway/cli
railway login
railway init
railway add --plugin postgresql
railway up
```

## Documentación

- `frontend/deploy/DEPLOY.md` — guía de despliegue paso a paso
- `frontend/deploy/OPERATIONS.md` — runbook de operaciones
- `docs/schema.sql` — schema completo de la base de datos
