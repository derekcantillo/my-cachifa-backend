-- Credit card installment plans (docs/design-liabilities.md D, step 5).
-- Additive only: two new enum types, the installment_plans table, two
-- nullable columns on transactions and one new TransactionType value.
-- Existing transactions keep installment_plan_id = NULL.
--
-- FINANCED_PURCHASE is not used here: Postgres rejects using a new value of an
-- existing enum in the same transaction that adds it. The rules that mention it
-- (only /installment-plans creates it; one per PURCHASE plan) live in the API.
-- The CHECKs below only repeat the API ranges, as a last line of defense.

-- CreateEnum
CREATE TYPE "InstallmentPlanKind" AS ENUM ('PURCHASE', 'REFINANCE', 'LEGACY');

-- CreateEnum
CREATE TYPE "InstallmentPlanStatus" AS ENUM ('ACTIVE', 'SETTLED');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'FINANCED_PURCHASE';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "installment_number" INTEGER,
ADD COLUMN     "installment_plan_id" TEXT;

-- CreateTable
CREATE TABLE "installment_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "kind" "InstallmentPlanKind" NOT NULL,
    "description" TEXT NOT NULL,
    "category" "Category",
    "principal" DECIMAL(12,2) NOT NULL,
    "installment_count" INTEGER NOT NULL,
    "monthly_rate" DECIMAL(7,4) NOT NULL,
    "start_date" DATE NOT NULL,
    "first_statement_date" DATE NOT NULL,
    "billed_before_tracking" INTEGER NOT NULL DEFAULT 0,
    "recognize_installments" BOOLEAN NOT NULL,
    "status" "InstallmentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "settled_at" DATE,
    "settlement_installment" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "installment_plans_user_id_idx" ON "installment_plans"("user_id");

-- CreateIndex
CREATE INDEX "installment_plans_account_id_idx" ON "installment_plans"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_installment_plan_id_installment_number_key" ON "transactions"("installment_plan_id", "installment_number");

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_plan_id_fkey" FOREIGN KEY ("installment_plan_id") REFERENCES "installment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Same ranges as the API (Prisma does not model CHECK constraints).
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_principal_positive" CHECK ("principal" > 0),
ADD CONSTRAINT "installment_plans_installment_count_range" CHECK ("installment_count" BETWEEN 2 AND 48),
ADD CONSTRAINT "installment_plans_billed_before_tracking_range" CHECK ("billed_before_tracking" >= 0 AND "billed_before_tracking" < "installment_count"),
ADD CONSTRAINT "installment_plans_monthly_rate_non_negative" CHECK ("monthly_rate" >= 0),
ADD CONSTRAINT "installment_plans_settlement_installment_range" CHECK ("settlement_installment" BETWEEN 1 AND "installment_count");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_number_positive" CHECK ("installment_number" >= 1);
