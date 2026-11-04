-- Transfers between the user's own accounts (credit card payments, cash
-- advances, moving money). Additive only: a new enum value and a nullable
-- column. Existing rows are untouched and keep `to_account_id = NULL`.
--
-- The rules "only TRANSFER has to_account_id" and "origin != destination" live
-- in TransactionsService: a CHECK here could not mention 'TRANSFER' in the
-- same transaction that adds the value (Postgres rejects using a new enum
-- value before it is committed).

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'TRANSFER';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "to_account_id" TEXT;

-- CreateIndex
CREATE INDEX "transactions_to_account_id_idx" ON "transactions"("to_account_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
