-- Verificación del ancla de las tarjetas de crédito (docs/design-liabilities.md
-- B.4, paso 4). SOLO LECTURA: corre dentro de una transacción READ ONLY, así
-- que cualquier escritura fallaría. Necesita la migración
-- 20261104215958_add_credit_cards aplicada.
--
-- Uso (producción, sin modificarla):
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U postgres -d cachifa_db -v ON_ERROR_STOP=1 \
--     < scripts/verify-card-anchor.sql
--
-- Lo esperado justo después de anclar la TC VISA al extracto del 31/10/2026:
--   ancla_bogota = 2026-11-01 00:00:00, ancla_a_medianoche = t,
--   ancla_coincide_con_extracto = t, saldo_en_el_ancla = -4539024.00,
--   y saldo_actual = saldo_en_el_ancla + solo los movimientos posteriores.

BEGIN TRANSACTION READ ONLY;

-- Cada consulta parte de las tarjetas ("card_anchor"). Las fechas se guardan
-- como UTC sin zona; Bogotá es UTC-5 fijo. (Una transacción READ ONLY no
-- permite CREATE, ni siquiera de una vista temporal: por eso se repite.)

-- 1. El ancla de cada tarjeta y si coincide con el último extracto registrado.
WITH "card_anchor" AS (
    SELECT "a"."id", "a"."name", "a"."initial_balance", "a"."initial_balance_date",
           "a"."credit_limit", "a"."statement_day", "a"."payment_due_day",
           ("a"."initial_balance_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota' AS "ancla_bogota"
    FROM "accounts" AS "a"
    WHERE "a"."type" = 'CREDIT_CARD'
)
SELECT "c"."name" AS "tarjeta",
       "c"."credit_limit" AS "cupo",
       "c"."statement_day" AS "dia_corte",
       "c"."payment_due_day" AS "dia_pago",
       "c"."initial_balance" AS "saldo_en_el_ancla",
       "c"."ancla_bogota",
       "c"."ancla_bogota"::time = '00:00' AS "ancla_a_medianoche",
       "s"."statement_date" AS "fecha_extracto",
       "s"."created_at" AS "extracto_registrado",
       "c"."ancla_bogota" = ("s"."statement_date" + 1)::timestamp
         AND "c"."initial_balance" = "s"."new_amount" AS "ancla_coincide_con_extracto"
FROM "card_anchor" AS "c"
LEFT JOIN LATERAL (
    SELECT "j"."statement_date", "j"."new_amount", "j"."created_at"
    FROM "account_balance_adjustments" AS "j"
    WHERE "j"."account_id" = "c"."id" AND "j"."reason" = 'STATEMENT'
    ORDER BY "j"."created_at" DESC
    LIMIT 1
) AS "s" ON true
ORDER BY "c"."name";

-- 2. Saldo con la misma fórmula de la app (AccountsService.computeCurrentBalance),
--    y deuda, disponible y sobrecupo si la tarjeta tiene cupo. Los movimientos
--    anteriores al ancla ya están dentro del extracto: se cuentan solo para
--    informar.
WITH "card_anchor" AS (
    SELECT "a"."id", "a"."name", "a"."initial_balance", "a"."initial_balance_date",
           "a"."credit_limit", "a"."statement_day", "a"."payment_due_day",
           ("a"."initial_balance_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota' AS "ancla_bogota"
    FROM "accounts" AS "a"
    WHERE "a"."type" = 'CREDIT_CARD'
),
"movements" AS (
    SELECT "c"."id",
           count(*) FILTER (WHERE "t"."transaction_date" < "c"."initial_balance_date") AS "antes_del_ancla",
           count(*) FILTER (WHERE "c"."initial_balance_date" IS NULL
                               OR "t"."transaction_date" >= "c"."initial_balance_date") AS "despues_del_ancla",
           coalesce(sum(
             CASE
               WHEN "c"."initial_balance_date" IS NOT NULL
                    AND "t"."transaction_date" < "c"."initial_balance_date" THEN 0
               WHEN "t"."to_account_id" = "c"."id" AND "t"."type" = 'TRANSFER' THEN "t"."amount"
               WHEN "t"."account_id" = "c"."id" AND "t"."type" IN ('INCOME', 'LOAN_REPAYMENT') THEN "t"."amount"
               WHEN "t"."account_id" = "c"."id"
                    AND "t"."type" IN ('EXPENSE', 'SAVING', 'DEBT_PAYMENT', 'LOAN_GIVEN', 'TRANSFER', 'FINANCED_PURCHASE') THEN -"t"."amount"
               ELSE 0
             END), 0) AS "efecto"
    FROM "card_anchor" AS "c"
    LEFT JOIN "transactions" AS "t"
      ON "t"."account_id" = "c"."id" OR "t"."to_account_id" = "c"."id"
    GROUP BY "c"."id"
)
SELECT "c"."name" AS "tarjeta",
       "m"."antes_del_ancla",
       "m"."despues_del_ancla",
       "c"."initial_balance" + "m"."efecto" AS "saldo_actual",
       CASE WHEN "c"."credit_limit" IS NULL THEN NULL
            ELSE greatest(0, -("c"."initial_balance" + "m"."efecto")) END AS "deuda",
       CASE WHEN "c"."credit_limit" IS NULL THEN NULL
            ELSE greatest(0, "c"."credit_limit" - greatest(0, -("c"."initial_balance" + "m"."efecto"))) END AS "disponible",
       CASE WHEN "c"."credit_limit" IS NULL THEN NULL
            ELSE greatest(0, greatest(0, -("c"."initial_balance" + "m"."efecto")) - "c"."credit_limit") END AS "sobrecupo"
FROM "card_anchor" AS "c"
JOIN "movements" AS "m" ON "m"."id" = "c"."id"
ORDER BY "c"."name";

-- 3. Movimientos posteriores al ancla (deberían ser solo los del ciclo en
--    curso), con su día en Bogotá.
WITH "card_anchor" AS (
    SELECT "a"."id", "a"."name", "a"."initial_balance", "a"."initial_balance_date",
           "a"."credit_limit", "a"."statement_day", "a"."payment_due_day",
           ("a"."initial_balance_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota' AS "ancla_bogota"
    FROM "accounts" AS "a"
    WHERE "a"."type" = 'CREDIT_CARD'
)
SELECT "c"."name" AS "tarjeta", "t"."type", "t"."amount",
       ("t"."transaction_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota' AS "fecha_bogota",
       CASE WHEN "t"."to_account_id" = "c"."id" THEN 'entra' ELSE 'sale' END AS "sentido",
       "t"."description"
FROM "card_anchor" AS "c"
JOIN "transactions" AS "t"
  ON ("t"."account_id" = "c"."id" OR "t"."to_account_id" = "c"."id")
 AND ("c"."initial_balance_date" IS NULL
      OR "t"."transaction_date" >= "c"."initial_balance_date")
ORDER BY "c"."name", "t"."transaction_date";

-- 4. Historial de anclas de las tarjetas, del más nuevo al más viejo.
WITH "card_anchor" AS (
    SELECT "a"."id", "a"."name", "a"."initial_balance", "a"."initial_balance_date",
           "a"."credit_limit", "a"."statement_day", "a"."payment_due_day",
           ("a"."initial_balance_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota' AS "ancla_bogota"
    FROM "accounts" AS "a"
    WHERE "a"."type" = 'CREDIT_CARD'
)
SELECT "c"."name" AS "tarjeta", "j"."reason", "j"."statement_date",
       "j"."old_amount", ("j"."old_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota' AS "ancla_anterior",
       "j"."new_amount", ("j"."new_date" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota' AS "ancla_nueva",
       "j"."old_credit_limit", "j"."new_credit_limit",
       "j"."balance_before", "j"."balance_after",
       "j"."reverts_id", "j"."created_at"
FROM "card_anchor" AS "c"
JOIN "account_balance_adjustments" AS "j" ON "j"."account_id" = "c"."id"
ORDER BY "c"."name", "j"."created_at" DESC;

ROLLBACK;
