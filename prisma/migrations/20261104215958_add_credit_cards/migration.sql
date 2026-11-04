-- Credit cards (docs/design-liabilities.md, step 4). Additive only: four
-- nullable columns on accounts, a new enum type and the anchor history table.
-- Existing accounts keep every new column NULL, so every CREDIT_CARD stays
-- "unconfigured" (out of the net worth totals) until it is anchored.
--
-- No existing enum gets a new value. The CHECKs only repeat the API rules, as a
-- last line of defense: card fields are validated again in AccountsService.

-- CreateEnum
CREATE TYPE "BalanceAdjustmentReason" AS ENUM ('STATEMENT', 'INITIAL_BALANCE', 'REVERT');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "credit_limit" DECIMAL(12,2),
ADD COLUMN     "default_monthly_rate" DECIMAL(7,4),
ADD COLUMN     "payment_due_day" INTEGER,
ADD COLUMN     "statement_day" INTEGER;

-- CreateTable
CREATE TABLE "account_balance_adjustments" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "reason" "BalanceAdjustmentReason" NOT NULL,
    "old_amount" DECIMAL(12,2) NOT NULL,
    "old_date" TIMESTAMP(3),
    "new_amount" DECIMAL(12,2) NOT NULL,
    "new_date" TIMESTAMP(3),
    "old_credit_limit" DECIMAL(12,2),
    "new_credit_limit" DECIMAL(12,2),
    "statement_date" DATE,
    "balance_before" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "reverts_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_balance_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_balance_adjustments_reverts_id_key" ON "account_balance_adjustments"("reverts_id");

-- CreateIndex
CREATE INDEX "account_balance_adjustments_account_id_created_at_idx" ON "account_balance_adjustments"("account_id", "created_at");

-- AddForeignKey
ALTER TABLE "account_balance_adjustments" ADD CONSTRAINT "account_balance_adjustments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balance_adjustments" ADD CONSTRAINT "account_balance_adjustments_reverts_id_fkey" FOREIGN KEY ("reverts_id") REFERENCES "account_balance_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Same ranges as the API (Prisma does not model CHECK constraints).
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_credit_limit_positive" CHECK ("credit_limit" > 0),
ADD CONSTRAINT "accounts_statement_day_range" CHECK ("statement_day" BETWEEN 1 AND 31),
ADD CONSTRAINT "accounts_payment_due_day_range" CHECK ("payment_due_day" BETWEEN 1 AND 31),
ADD CONSTRAINT "accounts_default_monthly_rate_non_negative" CHECK ("default_monthly_rate" >= 0);
