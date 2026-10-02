-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "PurchaseKind" AS ENUM ('STOCK', 'ASSET', 'SERVICE');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('ISSUED', 'PART_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VendorInvoiceStatus" AS ENUM ('RECEIVED', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "MovementKind" AS ENUM ('RECEIPT', 'ISSUE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_USE', 'IN_REPAIR', 'IDLE', 'DISPOSED', 'LOST');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'WRITTEN_DOWN_VALUE');

-- CreateEnum
CREATE TYPE "BookingRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutpassStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'OUT', 'RETURNED', 'CANCELLED');

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "departmentId" TEXT;

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "departmentId" TEXT,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "categories" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "budgetLineId" TEXT,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "total" DECIMAL(14,2) NOT NULL,
    "workflowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "PurchaseKind" NOT NULL,
    "description" TEXT NOT NULL,
    "itemId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "estUnitPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PurchaseRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "requestId" TEXT,
    "vendorId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'ISSUED',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedOn" DATE,
    "taxPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "terms" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "kind" "PurchaseKind" NOT NULL,
    "description" TEXT NOT NULL,
    "itemId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "storeId" TEXT,
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "poLineId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorInvoice" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "VendorInvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "keeperId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reorderLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "MovementKind" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "departmentId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "location" TEXT,
    "custodianId" TEXT,
    "purchaseDate" DATE NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "salvageValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "usefulLifeYears" DOUBLE PRECISION NOT NULL,
    "method" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "wdvRate" DOUBLE PRECISION,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_USE',
    "poLineId" TEXT,
    "serialNo" TEXT,
    "disposedAt" TIMESTAMP(3),
    "disposalValue" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetEvent" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityBooking" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT,
    "bookedById" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "attendees" INTEGER,
    "status" "BookingRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "hostUserId" TEXT,
    "hostName" TEXT,
    "vehicleNo" TEXT,
    "idProof" TEXT,
    "passCode" TEXT,
    "expectedAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outpass" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "leaveAt" TIMESTAMP(3) NOT NULL,
    "returnBy" TIMESTAMP(3) NOT NULL,
    "status" "OutpassStatus" NOT NULL DEFAULT 'REQUESTED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "guardianNotified" BOOLEAN NOT NULL DEFAULT false,
    "outAt" TIMESTAMP(3),
    "inAt" TIMESTAMP(3),
    "late" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outpass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicVisit" (
    "id" TEXT NOT NULL,
    "studentId" TEXT,
    "employeeId" TEXT,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "complaint" TEXT NOT NULL,
    "vitals" JSONB,
    "diagnosis" TEXT,
    "treatment" TEXT,
    "prescription" TEXT,
    "referral" TEXT,
    "restDays" INTEGER NOT NULL DEFAULT 0,
    "certificate" BOOLEAN NOT NULL DEFAULT false,
    "attendedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Budget_fiscalYear_departmentId_key" ON "Budget"("fiscalYear", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_budgetId_accountId_key" ON "BudgetLine"("budgetId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_number_key" ON "PurchaseRequest"("number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_workflowId_key" ON "PurchaseRequest"("workflowId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_status_createdAt_idx" ON "PurchaseRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_number_key" ON "GoodsReceipt"("number");

-- CreateIndex
CREATE UNIQUE INDEX "VendorInvoice_vendorId_invoiceNo_key" ON "VendorInvoice"("vendorId", "invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "Store_name_key" ON "Store"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_code_key" ON "StockItem"("code");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_storeId_createdAt_idx" ON "StockMovement"("itemId", "storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tag_key" ON "Asset"("tag");

-- CreateIndex
CREATE INDEX "Asset_departmentId_status_idx" ON "Asset"("departmentId", "status");

-- CreateIndex
CREATE INDEX "AssetEvent_assetId_createdAt_idx" ON "AssetEvent"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "FacilityBooking_roomId_startsAt_idx" ON "FacilityBooking"("roomId", "startsAt");

-- CreateIndex
CREATE INDEX "FacilityBooking_status_idx" ON "FacilityBooking"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Visitor_passCode_key" ON "Visitor"("passCode");

-- CreateIndex
CREATE INDEX "Visitor_checkedInAt_idx" ON "Visitor"("checkedInAt");

-- CreateIndex
CREATE INDEX "Visitor_expectedAt_idx" ON "Visitor"("expectedAt");

-- CreateIndex
CREATE INDEX "Outpass_status_leaveAt_idx" ON "Outpass"("status", "leaveAt");

-- CreateIndex
CREATE INDEX "Outpass_studentId_idx" ON "Outpass"("studentId");

-- CreateIndex
CREATE INDEX "ClinicVisit_studentId_visitedAt_idx" ON "ClinicVisit"("studentId", "visitedAt");

-- CreateIndex
CREATE INDEX "ClinicVisit_employeeId_visitedAt_idx" ON "ClinicVisit"("employeeId", "visitedAt");

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityBooking" ADD CONSTRAINT "FacilityBooking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outpass" ADD CONSTRAINT "Outpass_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicVisit" ADD CONSTRAINT "ClinicVisit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicVisit" ADD CONSTRAINT "ClinicVisit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Hand-written integrity rules ──
CREATE TRIGGER "StockMovement_immutable" BEFORE UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();
CREATE TRIGGER "AssetEvent_immutable" BEFORE UPDATE OR DELETE ON "AssetEvent" FOR EACH ROW EXECUTE FUNCTION examcore_forbid_mutation();
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_amount" CHECK ("amount" >= 0);
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_values" CHECK ("quantity" > 0 AND "estUnitPrice" >= 0);
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_values" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "receivedQty" >= 0 AND "receivedQty" <= "quantity");
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_values" CHECK ("cost" >= 0 AND "salvageValue" >= 0 AND "salvageValue" <= "cost" AND "usefulLifeYears" > 0 AND ("wdvRate" IS NULL OR ("wdvRate" > 0 AND "wdvRate" < 100)));
ALTER TABLE "FacilityBooking" ADD CONSTRAINT "FacilityBooking_times" CHECK ("endsAt" > "startsAt");
ALTER TABLE "Outpass" ADD CONSTRAINT "Outpass_times" CHECK ("returnBy" > "leaveAt");
ALTER TABLE "ClinicVisit" ADD CONSTRAINT "ClinicVisit_patient" CHECK (("studentId" IS NULL) <> ("employeeId" IS NULL));
-- No two approved bookings of a room overlap (requests may, until one is approved).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "FacilityBooking" ADD CONSTRAINT "FacilityBooking_no_overlap" EXCLUDE USING gist ("roomId" WITH =, tsrange("startsAt", "endsAt") WITH &&) WHERE ("status" = 'APPROVED');
-- Stock can never go negative in a store.
CREATE OR REPLACE FUNCTION examcore_stock_nonnegative() RETURNS trigger AS $$
DECLARE bal DOUBLE PRECISION;
BEGIN
  IF NEW.quantity >= 0 THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW."itemId" || NEW."storeId"));
  SELECT COALESCE(SUM(quantity), 0) INTO bal FROM "StockMovement" WHERE "itemId" = NEW."itemId" AND "storeId" = NEW."storeId";
  IF bal + NEW.quantity < -0.000001 THEN RAISE EXCEPTION 'EXAMCORE: not enough stock in the store'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "StockMovement_nonnegative" BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION examcore_stock_nonnegative();
