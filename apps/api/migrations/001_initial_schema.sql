-- Experiments, their variants, and the data collected while they run.

CREATE TABLE experiments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name               text NOT NULL CHECK (length(btrim(name)) > 0),
  description        text,
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'running', 'paused', 'completed')),
  traffic_percentage integer NOT NULL DEFAULT 100
                     CHECK (traffic_percentage BETWEEN 0 AND 100),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  ended_at           timestamptz
);

CREATE TABLE variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments (id) ON DELETE CASCADE,
  key           text NOT NULL CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  weight        integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  is_control    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, key)
);

-- At most one control variant per experiment
CREATE UNIQUE INDEX variants_one_control_per_experiment
  ON variants (experiment_id) WHERE is_control;

-- Who saw which variant. The first exposure of a subject is the one that counts.
CREATE TABLE exposures (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments (id) ON DELETE CASCADE,
  variant_id    uuid NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
  subject_id    text NOT NULL CHECK (length(subject_id) > 0),
  exposed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, subject_id)
);

CREATE INDEX exposures_variant_idx ON exposures (variant_id);

-- Conversion and behavior events, tied to a subject. The idempotency key lets
-- clients retry a request without counting the same event twice.
CREATE TABLE events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key text UNIQUE,
  subject_id      text NOT NULL CHECK (length(subject_id) > 0),
  name            text NOT NULL CHECK (length(name) > 0),
  value           numeric NOT NULL DEFAULT 0,
  properties      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_subject_idx ON events (subject_id);
CREATE INDEX events_name_time_idx ON events (name, occurred_at);
