-- Prefix HR trigger messages so the UI can show them.
-- Payslips freeze once the run is approved.
CREATE OR REPLACE FUNCTION examcore_protect_payslip() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT "status"::text INTO st FROM "PayrollRun" WHERE "id" = COALESCE(OLD."runId", NEW."runId");
  IF st IN ('APPROVED', 'PAID') THEN
    RAISE EXCEPTION 'EXAMCORE: Payslips of an approved payroll run cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

-- Payroll status only moves forward (a returned run goes back to COMPUTED for recomputation).
CREATE OR REPLACE FUNCTION examcore_protect_payroll_run() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('APPROVED', 'PAID') THEN RAISE EXCEPTION 'EXAMCORE: An approved payroll run cannot be deleted' USING ERRCODE = 'integrity_constraint_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'PAID' OR (OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPROVED', 'PAID')) THEN
    RAISE EXCEPTION 'EXAMCORE: Payroll run % is %; it cannot move to %', OLD."period", OLD."status", NEW."status" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
