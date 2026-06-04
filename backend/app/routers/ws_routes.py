import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from asyncpg import Pool
from app.core.database import get_pool, listen_to_channel, unlisten_from_channel

log = logging.getLogger(__name__)
router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self._route_sockets: dict[str, dict[str, WebSocket]] = {}
        self._conn_routes:   dict[str, set[str]] = {}
        self._capacity_cache: dict[str, int | None] = {}

    async def subscribe(self, connection_id: str, ws: WebSocket, route_id: str, pool: Pool) -> None:
        channel = f"route:{route_id}"
        self._route_sockets.setdefault(route_id, {})[connection_id] = ws
        self._conn_routes.setdefault(connection_id, set()).add(route_id)

        async def on_notify(pid: str, payload: str) -> None:
            await self._broadcast_to_route(route_id, payload)

        await listen_to_channel(channel, on_notify)

    async def close_route_channel(self, route_id: str, send_close_message: bool = False) -> int:
        sockets = self._route_sockets.pop(route_id, {})
        for conn_id, ws in sockets.items():
            try:
                await ws.close(code=1000)
            except Exception:
                pass
            if conn_id in self._conn_routes:
                self._conn_routes[conn_id].discard(route_id)
        return len(sockets)

    async def disconnect(self, connection_id: str) -> None:
        routes = self._conn_routes.pop(connection_id, set()).copy()
        for route_id in routes:
            self._route_sockets.get(route_id, {}).pop(connection_id, None)

    async def _broadcast_to_route(self, route_id: str, raw_payload: str) -> None:
        try:
            data = json.loads(raw_payload)
        except Exception:
            return
        msg_str  = raw_payload
        sockets  = list(self._route_sockets.get(route_id, {}).items())
        dead_ids = []
        for conn_id, ws in sockets:
            try:
                await ws.send_text(msg_str)
            except Exception:
                dead_ids.append(conn_id)
        for conn_id in dead_ids:
            await self.disconnect(conn_id)
        if data.get("type") == "route_closed":
            await self.close_route_channel(route_id)

manager = ConnectionManager()

@router.websocket("/ws/routes/{route_id}")
async def route_websocket(
    websocket: WebSocket,
    route_id: str,
    token: str = Query(default=""),
    pool: Pool = Depends(get_pool),
) -> None:
    await websocket.accept()
    connection_id = f"{route_id}:{id(websocket)}"
    await websocket.send_json({"type": "connected", "connection_id": connection_id, "route_id": route_id})

    async with pool.acquire() as conn:
        snapshot = await conn.fetchrow("SELECT * FROM active_routes_live WHERE route_id = $1", route_id)
    if snapshot:
        await websocket.send_json({"type": "route_snapshot", "route_id": route_id, "data": dict(snapshot)})

    await manager.subscribe(connection_id, websocket, route_id, pool)

    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=60)
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                break
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(connection_id)
