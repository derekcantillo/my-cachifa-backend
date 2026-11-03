-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "loan_repayment_id" TEXT;

-- Relleno: hasta ahora `addRepayment` creaba el abono y su transacción
-- LOAN_REPAYMENT sin vínculo, con el mismo `loan_id`, `amount` y fecha
-- (`paid_at` = `transaction_date`). Se emparejan por esos tres campos.
-- Si hay duplicados exactos (dos abonos iguales y dos transacciones iguales),
-- `row_number` los empareja 1 a 1 en orden de creación, así ninguna
-- transacción queda vinculada a dos abonos. Lo que no tenga pareja (por
-- ejemplo, una transacción editada desde Gastos) queda en NULL; ver
-- prisma/verify-loan-repayment-links.sql.
WITH "repayments" AS (
    SELECT "id", "loan_id", "amount", "paid_at",
           row_number() OVER (
               PARTITION BY "loan_id", "amount", "paid_at"
               ORDER BY "created_at", "id"
           ) AS "rn"
    FROM "loan_repayments"
),
"movements" AS (
    SELECT "id", "loan_id", "amount", "transaction_date",
           row_number() OVER (
               PARTITION BY "loan_id", "amount", "transaction_date"
               ORDER BY "created_at", "id"
           ) AS "rn"
    FROM "transactions"
    WHERE "type" = 'LOAN_REPAYMENT'
      AND "loan_id" IS NOT NULL
      AND "loan_repayment_id" IS NULL
)
UPDATE "transactions" AS "t"
SET "loan_repayment_id" = "r"."id"
FROM "movements" AS "m"
JOIN "repayments" AS "r"
  ON  "r"."loan_id" = "m"."loan_id"
  AND "r"."amount" = "m"."amount"
  AND "r"."paid_at" = "m"."transaction_date"
  AND "r"."rn" = "m"."rn"
WHERE "t"."id" = "m"."id";

-- CreateIndex
CREATE UNIQUE INDEX "transactions_loan_repayment_id_key" ON "transactions"("loan_repayment_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loan_repayment_id_fkey" FOREIGN KEY ("loan_repayment_id") REFERENCES "loan_repayments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
