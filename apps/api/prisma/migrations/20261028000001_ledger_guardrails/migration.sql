-- =============================================================================
-- Ledger guardrails — DB-level enforcement of double-entry invariants.
--
-- 1. Ledger entries & transactions are immutable: UPDATE and DELETE are refused
--    at the database level. Corrections happen only through reversing entries.
-- 2. Every entry must have exactly one non-zero side (debit XOR credit).
-- 3. Every transaction must satisfy SUM(debits) = SUM(credits); checked
--    DEFERRABLE INITIALLY DEFERRED so multi-entry transactions are validated
--    at COMMIT time.
-- 4. AuditLog is append-only: UPDATE and DELETE are refused.
--
-- (TRUNCATE remains available to database administrators for environment
-- resets — row triggers do not fire on TRUNCATE — but there is no
-- application-level edit/delete code path for these tables.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. LedgerEntry immutability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payledger_protect_row() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payledger: table % is append-only (attempted %)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_immutable
BEFORE UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION payledger_protect_row();

CREATE TRIGGER ledger_transaction_immutable
BEFORE UPDATE OR DELETE ON "LedgerTransaction"
FOR EACH ROW EXECUTE FUNCTION payledger_protect_row();

CREATE TRIGGER audit_log_immutable
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION payledger_protect_row();

-- ---------------------------------------------------------------------------
-- 2. Entries carry exactly one non-zero side
-- ---------------------------------------------------------------------------
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_single_side_check"
  CHECK (
    ("debitAmount" > 0 AND "creditAmount" = 0)
    OR ("creditAmount" > 0 AND "debitAmount" = 0)
  );

-- ---------------------------------------------------------------------------
-- 3. Balanced transactions (deferred to COMMIT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payledger_assert_balanced() RETURNS trigger AS $$
DECLARE
  diff BIGINT;
BEGIN
  SELECT COALESCE(SUM("debitAmount"), 0) - COALESCE(SUM("creditAmount"), 0)
    INTO diff
    FROM "LedgerEntry"
   WHERE "transactionId" = NEW."transactionId";
  IF diff <> 0 THEN
    RAISE EXCEPTION 'payledger: unbalanced transaction % (debits - credits = %)',
      NEW."transactionId", diff
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_transaction_balanced
AFTER INSERT ON "LedgerEntry"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION payledger_assert_balanced();
