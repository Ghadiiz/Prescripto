-- 002 — speciality keywords for the assistant's suggest_speciality tool.
--
-- The tool is a pure lookup: a term that isn't in this table produces a
-- fallback listing every speciality, and nothing infers a mapping. So this
-- table is the whole behaviour of that tool.
--
-- These are ROUTING terms — body parts, life stages, service names and
-- everyday symptom words. A few lay condition names patients use to describe
-- themselves ('acne', 'flu') are included; clinical diagnoses are not. The
-- table signposts a speciality, it never tells anyone what they have.
--
-- Emergency phrasings ('chest pain', 'difficulty breathing') are deliberately
-- ABSENT. Those are the emergencyCheck guardrail's job in 2.4 — routing them
-- to a speciality would be exactly the wrong response.
--
-- Rows are reference data, not demo data, so they travel with the migration.
-- The seed script never runs against production (it opens with DELETE FROM),
-- so it is not an option for getting them there.

CREATE TABLE speciality_keywords (
  id INT PRIMARY KEY AUTO_INCREMENT,
  keyword VARCHAR(100) NOT NULL,
  speciality_id INT NOT NULL,
  -- Composite, not UNIQUE(keyword): one term may route to two specialities.
  -- Its leftmost prefix also serves the tool's `WHERE keyword = ?` lookup, so
  -- no separate index on keyword is needed.
  UNIQUE KEY uniq_keyword_speciality (keyword, speciality_id),
  -- CASCADE rather than the RESTRICT used on doctors.speciality_id: keywords
  -- are satellite data with no meaning once their speciality is gone.
  CONSTRAINT fk_speciality_keywords_speciality FOREIGN KEY (speciality_id)
    REFERENCES specialities (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Joined on speciality NAME, never a hardcoded id — the local seed pins ids
-- 7-12 but production's may differ. A name that doesn't match is dropped by
-- the join, so check the row count after applying: 55 expected.
INSERT INTO speciality_keywords (keyword, speciality_id)
SELECT k.keyword, s.id
  FROM (
              SELECT 'skin'             AS keyword, 'Dermatologist'       AS speciality
    UNION ALL SELECT 'hair',                        'Dermatologist'
    UNION ALL SELECT 'hair loss',                   'Dermatologist'
    UNION ALL SELECT 'nails',                       'Dermatologist'
    UNION ALL SELECT 'scalp',                       'Dermatologist'
    UNION ALL SELECT 'rash',                        'Dermatologist'
    UNION ALL SELECT 'itching',                     'Dermatologist'
    UNION ALL SELECT 'mole',                        'Dermatologist'
    UNION ALL SELECT 'acne',                        'Dermatologist'

    UNION ALL SELECT 'stomach',                     'Gastroenterologist'
    UNION ALL SELECT 'stomach ache',                'Gastroenterologist'
    UNION ALL SELECT 'abdominal',                   'Gastroenterologist'
    UNION ALL SELECT 'digestion',                   'Gastroenterologist'
    UNION ALL SELECT 'gut',                         'Gastroenterologist'
    UNION ALL SELECT 'bowel',                       'Gastroenterologist'
    UNION ALL SELECT 'liver',                       'Gastroenterologist'
    UNION ALL SELECT 'nausea',                      'Gastroenterologist'

    UNION ALL SELECT 'brain',                       'Neurologist'
    UNION ALL SELECT 'nerve',                       'Neurologist'
    UNION ALL SELECT 'nerves',                      'Neurologist'
    UNION ALL SELECT 'headache',                    'Neurologist'
    UNION ALL SELECT 'dizziness',                   'Neurologist'
    UNION ALL SELECT 'numbness',                    'Neurologist'
    UNION ALL SELECT 'memory',                      'Neurologist'

    UNION ALL SELECT 'pregnancy',                   'Gynecologist'
    UNION ALL SELECT 'pregnant',                    'Gynecologist'
    UNION ALL SELECT 'prenatal',                    'Gynecologist'
    UNION ALL SELECT 'period',                      'Gynecologist'
    UNION ALL SELECT 'menstrual',                   'Gynecologist'
    UNION ALL SELECT 'menopause',                   'Gynecologist'
    UNION ALL SELECT 'fertility',                   'Gynecologist'
    UNION ALL SELECT 'women''s health',             'Gynecologist'
    UNION ALL SELECT 'birth control',               'Gynecologist'

    UNION ALL SELECT 'child',                       'Pediatricians'
    UNION ALL SELECT 'children',                    'Pediatricians'
    UNION ALL SELECT 'kid',                         'Pediatricians'
    UNION ALL SELECT 'baby',                        'Pediatricians'
    UNION ALL SELECT 'infant',                      'Pediatricians'
    UNION ALL SELECT 'toddler',                     'Pediatricians'
    UNION ALL SELECT 'newborn',                     'Pediatricians'
    UNION ALL SELECT 'vaccination',                 'Pediatricians'

    UNION ALL SELECT 'checkup',                     'General physician'
    UNION ALL SELECT 'general checkup',             'General physician'
    UNION ALL SELECT 'family doctor',               'General physician'
    UNION ALL SELECT 'fever',                       'General physician'
    UNION ALL SELECT 'cough',                       'General physician'
    UNION ALL SELECT 'cold',                        'General physician'
    UNION ALL SELECT 'tiredness',                   'General physician'
    UNION ALL SELECT 'blood test',                  'General physician'
    UNION ALL SELECT 'referral',                    'General physician'
    UNION ALL SELECT 'flu',                         'General physician'
    -- No orthopedist or physiotherapist speciality exists, so musculoskeletal
    -- complaints route to the GP, who refers onward.
    UNION ALL SELECT 'back pain',                   'General physician'
    UNION ALL SELECT 'joint pain',                  'General physician'
    UNION ALL SELECT 'knee pain',                   'General physician'
    -- Intentionally a second speciality for this term.
    UNION ALL SELECT 'vaccination',                 'General physician'
  ) k
  JOIN specialities s ON s.name = k.speciality;
