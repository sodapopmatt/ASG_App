import os
import sys

# Stub Supabase credentials before any app import — app.database builds a real
# client at import time, but no network call is made at construction.
# Key must be JWT-shaped to pass supabase-py's constructor validation
_FAKE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.dGVzdC1zaWduYXR1cmU"
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", _FAKE_JWT)
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", _FAKE_JWT)

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
