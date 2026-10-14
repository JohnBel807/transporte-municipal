from pydantic_settings import BaseSettings
from pydantic import SecretStr

n8n_webhook_reserva_creada:       str = ""
n8n_webhook_ruta_activada:        str = ""
n8n_webhook_conductor_registrado: str = ""

class Settings(BaseSettings):
    app_env: str = "development"
    zone_config_default: str = "velez_ricaurte"

    database_url: str
    database_url_sync: str
    database_url_test: str = ""
    db_pool_min_size: int = 2
    db_pool_max_size: int = 10

    jwt_secret_key: SecretStr
    jwt_algorithm: str = "HS256"
    access_token_expire_min: int = 15
    refresh_token_expire_days: int = 30

    ws_heartbeat_interval: int = 30
    eta_alert_threshold_sec: int = 90

    metrics_enabled: bool = True
    metrics_token: str = "CHANGE_ME"
    log_level: str = "INFO"

    cors_origins: str = "http://localhost:5173"

    class Config:
        env_file = ".env"

settings = Settings()
