-- Tax profile fields on Employee: filing status for withholding, residence
-- city (NYC local tax), and employee-requested additional federal withholding.
ALTER TABLE "Employee" ADD COLUMN "residenceCity" TEXT;
ALTER TABLE "Employee" ADD COLUMN "filingStatus" TEXT NOT NULL DEFAULT 'SINGLE';
ALTER TABLE "Employee" ADD COLUMN "additionalFederalWithholdingCents" INTEGER NOT NULL DEFAULT 0;
