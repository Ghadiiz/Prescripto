-- 006 — waitlist and in-app notifications.
--
-- Phase 5 introduces the first state the assistant can CHANGE. Four phases of
-- tools have been strictly read-only; `join_waitlist` (5.3) is the single
-- exception rule 2 allows. The constraints below exist so that tool can be
-- small and still correct — a write path is safest when the database, not the
-- application, is the thing enforcing the rules.
--
-- IDENTITY (see the note at the top of 003): patient ids come from `users`,
-- doctor ids from `doctors` — separate tables with overlapping id spaces. Both
-- tables here are PATIENT-only, so `user_id` can and does carry a real foreign
-- key to `users`. That is the difference from `assistant_audit_log` and
-- `conversations`, which serve both roles and therefore cannot.
--
-- If doctor notifications are ever wanted, that is a migration: drop the FK
-- and add a `role` column, exactly as 003 did. Deliberately not pre-built.


-- A patient asking to be told when a doctor frees up in a date window.
CREATE TABLE waitlist (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  doctor_id INT NOT NULL,
  -- Inclusive range. A single-day request has date_from = date_to.
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  -- 'active' | 'notified' | 'cancelled'. VARCHAR rather than ENUM to match
  -- appointments.status, which the app already treats this way via
  -- constants/appointmentStatus.js.
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  -- The same device appointments.active_slot uses, and for the same reason.
  --
  -- It makes "you are already on this list" a DATABASE guarantee rather than a
  -- read-then-write check in the tool: two concurrent join attempts resolve to
  -- one success and one clean ER_DUP_ENTRY, with no application locking. That
  -- is what lets 5.3 stay a small function despite being the only write tool.
  --
  -- Only 'cancelled' releases the slot. 'notified' still holds it, so a
  -- patient who was told about an opening cannot silently stack a second
  -- identical request — they cancel first. Mirrors how a cancelled appointment
  -- frees its slot while a pending one does not.
  active_request VARCHAR(96) GENERATED ALWAYS AS (
    CASE WHEN status = 'cancelled' THEN NULL
         ELSE CONCAT(user_id, '_', doctor_id, '_', date_from, '_', date_to)
    END
  ) VIRTUAL,

  -- A reversed range would silently match nothing forever. MySQL 8.0.16+
  -- enforces CHECK rather than parsing and ignoring it; this database is 8.4.
  CONSTRAINT chk_waitlist_range CHECK (date_to >= date_from),

  UNIQUE KEY unique_active_request (active_request),
  -- What 5.4's cancellation hook matches on: "active rows for this doctor
  -- whose window contains the freed date." Leads with doctor_id because that
  -- is the equality, with the range columns last.
  KEY idx_match (doctor_id, status, date_from, date_to),
  -- "What am I waiting on?" for the patient's own list.
  KEY idx_user (user_id, status),

  CONSTRAINT fk_waitlist_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_waitlist_doctor FOREIGN KEY (doctor_id)
    REFERENCES doctors (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- In-app notifications. Deliberately in-app only — the plan's scope decision
-- is that the waitlist notifies in the app, not by email, so nothing here
-- reaches outside the system.
CREATE TABLE notifications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  -- VARCHAR, not ENUM: a new notification kind should not need a migration.
  -- The known values get a constants file when 5.2 needs them.
  type VARCHAR(64) NOT NULL,
  -- Whatever the type needs to render — doctor name, freed date, and so on.
  -- Read by the patient app, so it must never carry anything the patient may
  -- not see.
  payload JSON,
  -- NULL means unread. One column answering both "was it read" and "when",
  -- which a boolean cannot do; 5.2's unread count is `read_at IS NULL`.
  read_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Serves both of 5.2's queries: the unread count and the newest-first list.
  KEY idx_unread (user_id, read_at, created_at),

  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
