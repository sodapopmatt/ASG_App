import logging
import time
from typing import Any, Callable, TypeVar

from supabase import create_client, Client
from app.config import settings

logger = logging.getLogger(__name__)

supabase: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)

# Separate anon-key client used ONLY for verifying user access tokens via
# supabase.auth.get_user(). The main service-role client can behave
# unpredictably when its own auth headers collide with a user-supplied JWT.
supabase_anon: Client = create_client(settings.supabase_url, settings.supabase_anon_key)

T = TypeVar("T")


def db_call(fn: Callable[[], T], attempts: int = 2, backoff: float = 0.15) -> T:
    """Invoke a Supabase call with a single retry on transient httpx/httpcore errors.

    Under concurrent load supabase-py's shared sync httpx client can wedge on its
    HTTP/2 stream (httpcore.ReadError [Errno 11]). One quick retry absorbs those
    without surfacing a 500 to the user.
    """
    last_exc: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — supabase-py bubbles many exception types
            last_exc = exc
            logger.warning("Supabase call failed (attempt %d/%d): %s", i + 1, attempts, exc)
            if i + 1 < attempts:
                time.sleep(backoff * (2 ** i))
    assert last_exc is not None
    raise last_exc

