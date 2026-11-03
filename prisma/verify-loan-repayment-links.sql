-- Verificación del vínculo abono ↔ transacción LOAN_REPAYMENT (migración
-- 20261103165922_link_loan_repayment_transactions). SOLO LECTURA: corre dentro
-- de una transacción READ ONLY, así que cualquier escritura fallaría.
-- Necesita la migración ya aplicada (usa la columna loan_repayment_id).
--
-- Uso (producción, sin modificarla):
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U postgres -d cachifa_db -v ON_ERROR_STOP=1 \
--     < prisma/verify-loan-repayment-links.sql

BEGIN TRANSACTION READ ONLY;

-- Resumen. Lo esperado: abonos_sin_pareja = 0 y transacciones_sin_abono = 0.
SELECT
    (SELECT count(*) FROM "loan_repayments") AS "abonos_totales",
    (SELECT count(*) FROM "loan_repayments" AS "r"
      WHERE EXISTS (SELECT 1 FROM "transactions" AS "t"
                     WHERE "t"."loan_repayment_id" = "r"."id")) AS "abonos_vinculados",
    (SELECT count(*) FROM "loan_repayments" AS "r"
      WHERE NOT EXISTS (SELECT 1 FROM "transactions" AS "t"
                         WHERE "t"."loan_repayment_id" = "r"."id")) AS "abonos_sin_pareja",
    (SELECT count(*) FROM "transactions"
      WHERE "type" = 'LOAN_REPAYMENT'
        AND "loan_repayment_id" IS NULL) AS "transacciones_sin_abono";

-- Detalle de lo que quedó sin emparejar, para revisarlo a mano.
SELECT 'abono_sin_pareja' AS "caso", "r"."id", "r"."loan_id",
       "r"."amount", "r"."paid_at" AS "fecha"
FROM "loan_repayments" AS "r"
WHERE NOT EXISTS (SELECT 1 FROM "transactions" AS "t"
                   WHERE "t"."loan_repayment_id" = "r"."id")
UNION ALL
SELECT 'transaccion_sin_abono', "t"."id", "t"."loan_id",
       "t"."amount", "t"."transaction_date"
FROM "transactions" AS "t"
WHERE "t"."type" = 'LOAN_REPAYMENT'
  AND "t"."loan_repayment_id" IS NULL
ORDER BY "caso", "loan_id", "fecha";

ROLLBACK;
