import asyncio
import asyncpg
import logging
from typing import Callable, Awaitable
from app.core.config import settings

log = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None
_listener_conn: asyncpg.Connection | None = None
_channel_callbacks: dict[str, list[Callable]] = {}

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.database_url.replace("+asyncpg", ""),
            min_size=settings.db_pool_min_size,
            max_size=settings.db_pool_max_size,
        )
    return _pool

async def get_listener() -> asyncpg.Connection:
    global _listener_conn
    if _listener_conn is None or _listener_conn.is_closed():
        _listener_conn = await asyncpg.connect(
            dsn=settings.database_url.replace("+asyncpg", "")
        )
        log.info("Listener connection established")
    return _listener_conn

async def listen_to_channel(channel: str, callback: Callable[[str, str], Awaitable[None]]) -> None:
    conn = await get_listener()
    if channel not in _channel_callbacks:
        _channel_callbacks[channel] = []
        await conn.add_listener(channel, _dispatch_notification)
        await conn.execute(f'LISTEN "{channel}"')
        log.info("Listening on channel: %s", channel)
    _channel_callbacks[channel].append(callback)

async def unlisten_from_channel(channel: str, callback: Callable | None) -> None:
    if channel not in _channel_callbacks:
        return
    if callback:
        try:
            _channel_callbacks[channel].remove(callback)
        except ValueError:
            pass
    if not _channel_callbacks.get(channel):
        conn = await get_listener()
        await conn.execute(f'UNLISTEN "{channel}"')
        _channel_callbacks.pop(channel, None)
        log.info("Unlistened from channel: %s", channel)

def _dispatch_notification(conn: asyncpg.Connection, pid: int, channel: str, payload: str) -> None:
    handlers = _channel_callbacks.get(channel, [])
    for handler in handlers:
        asyncio.ensure_future(handler(str(pid), payload))

async def close_database() -> None:
    global _pool, _listener_conn
    if _listener_conn and not _listener_conn.is_closed():
        await _listener_conn.close()
    if _pool:
        await _pool.close()
