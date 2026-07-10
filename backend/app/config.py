import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str

    # Defaults to the production .env; set ENV_FILE=.env.sandbox to run this
    # process against the sandbox project instead (see .env.sandbox).
    model_config = {"env_file": os.getenv("ENV_FILE", ".env")}


settings = Settings()
