-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'PARTIALLY_PAID', 'PAID');

-- AlterEnum
ALTER TYPE "Category" ADD VALUE 'LOAN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'LOAN_GIVEN';
ALTER TYPE "TransactionType" ADD VALUE 'LOAN_REPAYMENT';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "initial_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "initial_balance_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "loan_id" TEXT;

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "borrower_name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "amount_repaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "loan_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "note" TEXT,
    "account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_repayments" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loans_user_id_idx" ON "loans"("user_id");

-- CreateIndex
CREATE INDEX "loans_account_id_idx" ON "loans"("account_id");

-- CreateIndex
CREATE INDEX "loan_repayments_loan_id_idx" ON "loan_repayments"("loan_id");

-- CreateIndex
CREATE INDEX "transactions_loan_id_idx" ON "transactions"("loan_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
