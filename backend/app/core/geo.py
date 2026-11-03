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


def distance_to_polygon_km(lat: float, lng: float, poly: list[tuple[float, float]]) -> float:
    """Distancia (km) del punto al borde más cercano del polígono (0 si está dentro)."""
    from math import cos, radians, sqrt
    if point_in_polygon(lat, lng, poly):
        return 0.0
    kx = 111.32 * cos(radians(lat))   # km por grado de longitud
    ky = 110.57                       # km por grado de latitud
    best = float("inf")
    n = len(poly)
    for i in range(n):
        ay, ax = poly[i]
        by, bx = poly[(i + 1) % n]
        px, py = (lng - ax) * kx, (lat - ay) * ky
        dx, dy = (bx - ax) * kx, (by - ay) * ky
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, (px * dx + py * dy) / seg2))
        best = min(best, sqrt((px - t * dx) ** 2 + (py - t * dy) ** 2))
    return best