-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertType" ADD VALUE 'RECURRING_EXPENSE_DUE';
ALTER TYPE "AlertType" ADD VALUE 'SAVINGS_TARGET_AT_RISK';

-- AlterEnum
ALTER TYPE "Category" ADD VALUE 'CONTINGENCY';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "recurring_expense_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "target_savings_percentage" DECIMAL(5,2) NOT NULL DEFAULT 30.00;

-- CreateTable
CREATE TABLE "recurring_expenses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "estimated_amount" DECIMAL(12,2) NOT NULL,
    "is_amount_fixed" BOOLEAN NOT NULL DEFAULT false,
    "day_of_month" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_expenses_user_id_idx" ON "recurring_expenses"("user_id");

-- CreateIndex
CREATE INDEX "transactions_recurring_expense_id_idx" ON "transactions"("recurring_expense_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_expense_id_fkey" FOREIGN KEY ("recurring_expense_id") REFERENCES "recurring_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
