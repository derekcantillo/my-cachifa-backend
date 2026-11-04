-- "Mis productos" (docs/design-liabilities.md, step 3). Additive only: a new
-- table, three nullable/defaulted columns on accounts and two enum values.
-- Existing accounts keep institution_id = NULL, has_debit_card = false and
-- card_last4 = NULL, and their type is not touched.
--
-- Nothing here uses CHECKING_ACCOUNT or DIGITAL_WALLET: Postgres rejects using
-- a new enum value in the same transaction that adds it. DEBIT_CARD stays in
-- the enum and is rejected by the API on create and update. Rules about which
-- types may have a debit card or card digits live in AccountsService.

-- AlterEnum
ALTER TYPE "AccountType" ADD VALUE 'CHECKING_ACCOUNT';
ALTER TYPE "AccountType" ADD VALUE 'DIGITAL_WALLET';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "card_last4" VARCHAR(4),
ADD COLUMN     "has_debit_card" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "institution_id" TEXT;

-- CreateTable
CREATE TABLE "financial_institutions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_institutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_institutions_user_id_name_key" ON "financial_institutions"("user_id", "name");

-- CreateIndex
CREATE INDEX "accounts_institution_id_idx" ON "accounts"("institution_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "financial_institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_institutions" ADD CONSTRAINT "financial_institutions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

