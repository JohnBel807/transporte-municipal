from __future__ import annotations
from typing import Annotated, Literal
from pydantic import BaseModel, Field, field_validator, model_validator
from enum import Enum

class RouteStatus(str, Enum):
    PAUSED   = "pausada"
    ACTIVE   = "activa"
    ARCHIVED = "archivada"

class WaypointCreate(BaseModel):
    sequence_order: Annotated[int, Field(ge=0)]
    place_name: Annotated[str, Field(min_length=2, max_length=120)]
    latitude: Annotated[float, Field(ge=-90, le=90)]
    longitude: Annotated[float, Field(ge=-180, le=180)]
    is_terminal: bool = False
    estimated_wait_min: Annotated[int, Field(ge=0, le=60)] = 0

    @field_validator("place_name")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()

class RouteCreate(BaseModel):
    route_name: Annotated[str, Field(min_length=3, max_length=100)]
    description: Annotated[str, Field(max_length=500)] = ""
    base_fare: Annotated[float, Field(gt=0)]
    tolerance_m: Annotated[int, Field(ge=100, le=1000)] = 300
    is_public: bool = False
    estimated_duration_min: Annotated[int, Field(ge=1, le=480)] = 30
    waypoints: list[WaypointCreate] = Field(min_length=2, max_length=30)

    @model_validator(mode="after")
    def validate_waypoints(self) -> "RouteCreate":
        seqs = [w.sequence_order for w in self.waypoints]
        if len(seqs) != len(set(seqs)):
            raise ValueError("sequence_order debe ser único")
        if sorted(seqs) != list(range(len(seqs))):
            raise ValueError("sequence_order debe ser consecutivo desde 0")
        terminals = [w for w in self.waypoints if w.is_terminal]
        if len(terminals) < 2:
            raise ValueError("La ruta necesita al menos 2 paradas terminales")
        ordered = sorted(self.waypoints, key=lambda w: w.sequence_order)
        if not ordered[0].is_terminal or not ordered[-1].is_terminal:
            raise ValueError("El primer y último waypoint deben ser terminales")
        return self

class WaypointResponse(BaseModel):
    id: str
    sequence_order: int
    place_name: str
    latitude: float
    longitude: float
    is_terminal: bool
    estimated_wait_min: int

class RouteCreateResponse(BaseModel):
    route_id: str
    route_name: str
    status: str
    is_public: bool
    waypoints: list[WaypointResponse]
    corridor_built: bool
    message: str

class DeactivateRouteRequest(BaseModel):
    reason: Annotated[str, Field(max_length=300)] = ""
    final_status: Literal["pausada", "archivada"] = "pausada"

class DeactivateRouteResponse(BaseModel):
    route_id: str
    previous_status: str
    current_status: str
    driver_status: str
    passengers_notified: int
    subscriptions_cleared: int
    deactivated_by: str
    reason: str
    message: str

class ActivateRouteResponse(BaseModel):
    route_id: str
    status: RouteStatus
    activated_at: str
    driver_location: dict
    zone_confirmed: str
    message: str
