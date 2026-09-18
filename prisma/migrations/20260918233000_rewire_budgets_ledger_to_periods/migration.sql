-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'PERIOD_DEFICIT';

-- DropForeignKey
ALTER TABLE "monthly_ledgers" DROP CONSTRAINT "monthly_ledgers_user_id_fkey";

-- DropIndex
DROP INDEX "budgets_user_id_month_year_category_key";

-- DropIndex
DROP INDEX "budgets_user_id_month_year_idx";

-- DropIndex
DROP INDEX "transactions_period_id_idx";

-- DropIndex
DROP INDEX "transactions_user_id_month_year_idx";

-- Budget y MonthlyLedger son datos derivados (límites de RecurringExpense /
-- BudgetRule, gasto y saldos de las transacciones). Se vacían aquí y se
-- reconstruyen por período con POST /api/v1/admin/migrate-periods.
DELETE FROM "budgets";

-- AlterTable
ALTER TABLE "budgets" DROP COLUMN "month_year",
ADD COLUMN     "period_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "monthly_ledgers";

-- CreateTable
CREATE TABLE "period_ledgers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "income" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expenses" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "savings" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closing_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "period_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "period_ledgers_period_id_idx" ON "period_ledgers"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "period_ledgers_user_id_period_id_key" ON "period_ledgers"("user_id", "period_id");

-- CreateIndex
CREATE INDEX "budgets_period_id_idx" ON "budgets"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_user_id_period_id_category_key" ON "budgets"("user_id", "period_id", "category");

-- CreateIndex
CREATE INDEX "transactions_user_id_period_id_idx" ON "transactions"("user_id", "period_id");

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "financial_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_ledgers" ADD CONSTRAINT "period_ledgers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_ledgers" ADD CONSTRAINT "period_ledgers_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "financial_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `month_year` (deprecado) se derivaba en hora del servidor (UTC). Se
-- recalcula en hora de Bogotá, la misma de los períodos financieros.
UPDATE "transactions"
SET "month_year" = to_char(("transaction_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota', 'YYYY-MM');
