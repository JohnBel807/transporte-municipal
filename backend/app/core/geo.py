"""Utilidades geográficas sin PostGIS."""


def parse_polygon(raw) -> list[tuple[float, float]]:
    """Convierte JSONB ([[lat,lng],...] o str JSON) en lista de tuplas."""
    import json
    if isinstance(raw, str):
        raw = json.loads(raw)
    return [(float(p[0]), float(p[1])) for p in raw]


def point_in_polygon(lat: float, lng: float, poly: list[tuple[float, float]]) -> bool:
    """Ray casting. poly = [(lat, lng), ...]"""
    inside = False
    n = len(poly)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside
