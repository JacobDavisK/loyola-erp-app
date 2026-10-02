-- CreateEnum
CREATE TYPE "BadgeKind" AS ENUM ('BADGE', 'MICRO_CREDENTIAL', 'CERTIFICATE_OF_PARTICIPATION');

-- CreateEnum
CREATE TYPE "VcKind" AS ENUM ('ACADEMIC', 'BADGE', 'LEARNER_RECORD');

-- CreateTable
CREATE TABLE "SigningKey" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "publicJwk" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgeClass" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BadgeKind" NOT NULL DEFAULT 'BADGE',
    "description" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "skills" TEXT[],
    "credits" DOUBLE PRECISION,
    "hours" DOUBLE PRECISION,
    "departmentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgeAward" (
    "id" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "evidence" TEXT,
    "awardedById" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "BadgeAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifiableCredential" (
    "id" TEXT NOT NULL,
    "kind" "VcKind" NOT NULL,
    "studentId" TEXT NOT NULL,
    "issuedCredentialId" TEXT,
    "badgeAwardId" TEXT,
    "jwt" TEXT NOT NULL,
    "types" TEXT[],
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "VerifiableCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialShare" (
    "id" TEXT NOT NULL,
    "vcId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SigningKey_kid_key" ON "SigningKey"("kid");

-- CreateIndex
CREATE INDEX "SigningKey_purpose_active_idx" ON "SigningKey"("purpose", "active");

-- CreateIndex
CREATE INDEX "BadgeClass_active_idx" ON "BadgeClass"("active");

-- CreateIndex
CREATE INDEX "BadgeAward_studentId_idx" ON "BadgeAward"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "BadgeAward_badgeId_studentId_key" ON "BadgeAward"("badgeId", "studentId");

-- CreateIndex
CREATE INDEX "VerifiableCredential_studentId_kind_idx" ON "VerifiableCredential"("studentId", "kind");

-- CreateIndex
CREATE INDEX "VerifiableCredential_issuedCredentialId_idx" ON "VerifiableCredential"("issuedCredentialId");

-- CreateIndex
CREATE INDEX "VerifiableCredential_badgeAwardId_idx" ON "VerifiableCredential"("badgeAwardId");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialShare_tokenHash_key" ON "CredentialShare"("tokenHash");

-- CreateIndex
CREATE INDEX "CredentialShare_vcId_idx" ON "CredentialShare"("vcId");

-- AddForeignKey
ALTER TABLE "BadgeAward" ADD CONSTRAINT "BadgeAward_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "BadgeClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeAward" ADD CONSTRAINT "BadgeAward_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiableCredential" ADD CONSTRAINT "VerifiableCredential_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialShare" ADD CONSTRAINT "CredentialShare_vcId_fkey" FOREIGN KEY ("vcId") REFERENCES "VerifiableCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written integrity rules ──
-- A signed credential is never edited; revocation sets revokedAt only.
CREATE OR REPLACE FUNCTION examcore_protect_vc() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'EXAMCORE: verifiable credentials cannot be deleted; revoke them instead'; END IF;
  IF NEW.jwt <> OLD.jwt OR NEW."studentId" <> OLD."studentId" OR NEW.kind <> OLD.kind THEN RAISE EXCEPTION 'EXAMCORE: a signed credential cannot be changed'; END IF;
  IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN RAISE EXCEPTION 'EXAMCORE: revocation cannot be undone'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "VerifiableCredential_protect" BEFORE UPDATE OR DELETE ON "VerifiableCredential" FOR EACH ROW EXECUTE FUNCTION examcore_protect_vc();
ALTER TABLE "BadgeClass" ADD CONSTRAINT "BadgeClass_amounts" CHECK (("credits" IS NULL OR "credits" > 0) AND ("hours" IS NULL OR "hours" > 0));
