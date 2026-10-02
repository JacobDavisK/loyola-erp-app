-- CreateTable
CREATE TABLE "DemoGrant" (
    "id" TEXT NOT NULL,
    "demoUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoGrant_email_key" ON "DemoGrant"("email");

-- CreateIndex
CREATE INDEX "DemoGrant_demoUserId_idx" ON "DemoGrant"("demoUserId");

-- AddForeignKey
ALTER TABLE "DemoGrant" ADD CONSTRAINT "DemoGrant_demoUserId_fkey" FOREIGN KEY ("demoUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written rules
ALTER TABLE "DemoGrant" ADD CONSTRAINT "DemoGrant_email_lower_check" CHECK ("email" = lower("email"));

-- The demo institution is renamed "University of the World" (only where the old demo name is still in use).
UPDATE "Institution" SET "name" = 'University of the World', "shortName" = 'UW' WHERE "name" = 'Loyola University';
UPDATE "Template" SET "footerText" = replace("footerText", 'Loyola University', 'University of the World') WHERE "footerText" LIKE '%Loyola University%';
UPDATE "SystemSetting" SET "value" = jsonb_set("value"::jsonb, '{nadIssuerName}', '"University of the World"') WHERE "key" = 'nep' AND "value"->>'nadIssuerName' = 'Loyola University';
