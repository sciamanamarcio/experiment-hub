-- Feature flags: an on/off switch with a gradual rollout, and per-subject overrides.

CREATE TABLE feature_flags (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name               text NOT NULL CHECK (length(btrim(name)) > 0),
  description        text,
  enabled            boolean NOT NULL DEFAULT false,
  rollout_percentage integer NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Forces the flag on or off for one specific subject, regardless of the rollout
CREATE TABLE feature_flag_overrides (
  flag_id    uuid NOT NULL REFERENCES feature_flags (id) ON DELETE CASCADE,
  subject_id text NOT NULL CHECK (length(subject_id) > 0),
  enabled    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_id, subject_id)
);

CREATE INDEX feature_flag_overrides_subject_idx ON feature_flag_overrides (subject_id);
