-- companies.short_id was added to production by hand at some point without a
-- committed migration (backend/app/schemas/company.py has required it all
-- along). Adding it here so migrations replayed from scratch (e.g. a fresh
-- sandbox project) match what production actually has.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS short_id TEXT;

ALTER TABLE companies
    ADD CONSTRAINT companies_short_id_format CHECK (short_id ~ '^[A-Z0-9-]+$');

ALTER TABLE companies ADD CONSTRAINT companies_short_id_unique UNIQUE (short_id);

ALTER TABLE companies ALTER COLUMN short_id SET NOT NULL;
