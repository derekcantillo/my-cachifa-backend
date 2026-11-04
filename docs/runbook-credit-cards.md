# Runbook: tarjetas y planes de cuotas en producción

Pasos para poner las tarjetas reales (TC VISA Bancolombia y TC Davivienda) al día con los
pasos 4 y 5 de `docs/design-liabilities.md`. Todo se hace **por la API**, nunca por SQL,
y cada paso se puede deshacer. Probado en una copia de producción con
`scripts/test-migration-on-copy.sh` (2026-11-04).

Estado de producción al 2026-11-04: migraciones de los pasos 3 y 4 aplicadas; la del
paso 5 (`20261104223833_add_installment_plans`) pendiente; la TC VISA todavía **sin
anclar** y la TC Davivienda sin crear; el período abierto es "29 sep 2026 – en curso"
(el salario de octubre no está registrado).

## 0. Variables de la terminal

```bash
cd ~/Documents/projects/my-cachifa/my-cachifa-backend
read -rs KEY                                # la API key, sin que quede en el historial
API=http://127.0.0.1:3000/api/v1
H=(-H "X-API-Key: $KEY" -H 'Content-Type: application/json')
```

## 1. Backup del día (G.1)

```bash
scripts/backup-now.sh           # dump de solo lectura, verificado y restaurado en la base de descarte
```

Debe terminar en `✓ backup verified`. **Copia el archivo fuera del laptop** antes de seguir.

## 2. Desplegar el paso 5 (migración + código)

```bash
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml run --rm app pnpm prisma migrate status
#   pendiente: SOLO 20261104223833_add_installment_plans
docker compose -f docker-compose.prod.yml run --rm app pnpm prisma migrate deploy
docker compose -f docker-compose.prod.yml up -d app
curl -s $API/health
```

## 3. Anclar las tarjetas (paso 4), si no se ha hecho

```bash
curl -s "${H[@]}" $API/net-worth > /tmp/nw-antes.json
VISA=$(curl -s "${H[@]}" $API/accounts | jq -r '.[] | select(.name=="TC VISA Clásica") | .id')
AHORROS=$(curl -s "${H[@]}" $API/accounts | jq -r '.[] | select(.name=="Ahorros Bancolombia") | .id')

# TC VISA: guarda adjustment.id para poder revertir
curl -s "${H[@]}" -X POST $API/accounts/$VISA/statement-balance \
  -d '{"cutDate":"2026-10-31","totalDebt":4539024,"creditLimit":4300000}' | jq '{adj: .adjustment.id, tarjeta: .account.creditCard}'
curl -s "${H[@]}" -X PATCH $API/accounts/$VISA -d '{"statementDay":31,"paymentDueDay":17,"defaultMonthlyRate":2.1155}'

# TC Davivienda: cuenta nueva (con la entidad, si la creaste en "Mis productos")
DAV=$(curl -s "${H[@]}" -X POST $API/accounts -d '{"name":"TC Davivienda","type":"CREDIT_CARD"}' | jq -r .id)
curl -s "${H[@]}" -X POST $API/accounts/$DAV/statement-balance \
  -d '{"cutDate":"2026-10-29","totalDebt":4670990,"creditLimit":11500000}' | jq '.account.creditCard'
curl -s "${H[@]}" -X PATCH $API/accounts/$DAV -d '{"statementDay":29,"paymentDueDay":15}'
```

Esperado: VISA deuda 4.539.024 / disponible 0 / sobrecupo 239.024; Davivienda
4.670.990 / 6.829.010 / 0; el patrimonio baja 9.210.014. Si ya existe la TC Davivienda,
toma su id con `jq '.[] | select(.name=="TC Davivienda") | .id'` en lugar de crearla.

## 4. Registrar los planes reales

Ningún plan de estos crea transacción ni cambia el saldo de la tarjeta: su deuda ya está
dentro del ancla (`LEGACY` y `REFINANCE`). Solo agregan el calendario y, si cuentan como
gasto, la cuota de cada mes en el presupuesto.

Cómo leer "va en la k/N" del extracto: `billedBeforeTracking = k − 1` (las ya pagadas) y
`firstStatementDate` = cualquier día del mes que facturó la cuota 1 (el corte de la cuota
k menos k − 1 meses). Así la cuota k queda pendiente para el pago de este mes.

```bash
# TC Davivienda: celular, 6.999.000 a 24 cuotas al 0 %, la 9/24 en el corte del 29/10.
# startDate: pon la fecha real de la compra si la tienes (debe ser ≤ febrero 2026).
curl -s "${H[@]}" -X POST $API/installment-plans -d "{
  \"accountId\":\"$DAV\",\"kind\":\"LEGACY\",\"description\":\"Celular\",\"category\":\"PERSONAL\",
  \"principal\":6999000,\"installmentCount\":24,\"monthlyRate\":0,
  \"startDate\":\"2026-02-01\",\"firstStatementDate\":\"2026-02-28\",\"billedBeforeTracking\":8}" \
  | jq '{id, installmentAmount, currentInstallment, remainingPrincipal}'
#   esperado: 291625, 9, 4374375 (el banco dice 4.374.374: un peso de su redondeo)

# TC VISA: ampliación de plazo, 2.016.132,08 a 12 cuotas al 1,9915 %, la 7/12 en el corte
# del 31/10. Decidiste que cuenta como gasto: recognizeInstallments true, categoría DEBT.
curl -s "${H[@]}" -X POST $API/installment-plans -d "{
  \"accountId\":\"$VISA\",\"kind\":\"REFINANCE\",\"description\":\"Ampliación de plazo\",\"category\":\"DEBT\",
  \"principal\":2016132.08,\"installmentCount\":12,\"monthlyRate\":1.9915,
  \"startDate\":\"2026-04-01\",\"firstStatementDate\":\"2026-04-30\",\"billedBeforeTracking\":6,
  \"recognizeInstallments\":true}" | jq '{id, installmentAmount, currentInstallment, remainingPrincipal}'
#   esperado: 168011.01 (la última 168.010,97), 7, 840055.01

# TC VISA: compra de 1.605.708 a 36 cuotas al 2,1155 % del 12/10/2026 (cuota 1 en el corte del 31/10).
# Es anterior al ancla (1/11): va como LEGACY, no como PURCHASE.
curl -s "${H[@]}" -X POST $API/installment-plans -d "{
  \"accountId\":\"$VISA\",\"kind\":\"LEGACY\",\"description\":\"Compra del 12/10\",\"category\":\"PERSONAL\",
  \"principal\":1605708,\"installmentCount\":36,\"monthlyRate\":2.1155,\"startDate\":\"2026-10-12\"}" \
  | jq '{id, installmentAmount, currentInstallment, firstStatementDate}'
#   esperado: 44603, 1, 2026-10-31

# TC VISA: suscripción de 93.900 a 36 cuotas. CONFIRMA EN EL EXTRACTO la fecha, la tasa y en
# qué cuota va: aquí se supone de octubre (tasa de la tarjeta, 2,1155 %, cuota 1/36 en el
# corte del 31/10). Si va en la k/36, agrega firstStatementDate y billedBeforeTracking = k − 1.
# En la copia no había ningún movimiento de 93.900, así que cuenta como gasto (si lo
# hubiera, usa "recognizeInstallments": false para no contarla dos veces).
curl -s "${H[@]}" -X POST $API/installment-plans -d "{
  \"accountId\":\"$VISA\",\"kind\":\"LEGACY\",\"description\":\"Suscripción\",\"category\":\"SERVICES\",
  \"principal\":93900,\"installmentCount\":36,\"startDate\":\"2026-10-05\"}" \
  | jq '{id, monthlyRate, installmentAmount}'
#   esperado: 2.1155, 2608.33
```

Revisión: `curl -s "${H[@]}" $API/accounts | jq '.[] | select(.type=="CREDIT_CARD") | {name, currentBalance, creditCard}'`.
El saldo y la deuda de las tarjetas **no cambian**; `activePlans` = 3 (VISA) y 1 (Davivienda).

Para corregir un plan mientras no tenga cuotas registradas: `PATCH /installment-plans/:id`
con lo que cambie, o `DELETE /installment-plans/:id` y crearlo de nuevo.

## 5. Gastos fijos de la Davivienda

El pago real de la Davivienda (296.615) es la cuota del celular (291.625) más el seguro
(4.990). La cuota ya la cuenta el plan, así que el gasto fijo "Deuda celular" (297.615)
se **desactiva** (no se borra: conserva su historial) y el seguro pasa a ser su propio gasto fijo.

```bash
DEUDA=$(curl -s "${H[@]}" $API/recurring-expenses | jq -r '.[] | select(.name=="Deuda celular") | .id')
curl -s "${H[@]}" -X PATCH $API/recurring-expenses/$DEUDA -d '{"active":false}' | jq '{name, active}'
curl -s "${H[@]}" -X POST $API/recurring-expenses \
  -d '{"name":"Seguro TC Davivienda","category":"OTHER","estimatedAmount":4990,"isAmountFixed":true,"dayOfMonth":29}' | jq
```

Al registrar el seguro cada mes desde "Fijos por registrar", elige **TC Davivienda** como
cuenta: es un cargo de la tarjeta y sube su deuda, como la cuota de manejo (B.7).

## 6. Cada mes

1. **Salario:** registra el del período (el de octubre, del 29/10, todavía no está). Las
   cuotas que vencen el 15 y el 17 de noviembre caen en el período que abre ese salario.
2. **Cuotas:** `GET /installment-plans/pending` muestra las del período ("Cuotas de
   tarjeta"). Cuando pagues, `POST /installment-plans/pending/register` (o
   `POST /installment-plans/:id/installments/:n` una por una). Cada una queda como gasto
   sin cuenta, con la categoría de la compra, en su fecha de pago.
3. **Pago de la tarjeta:** es una `TRANSFER` Ahorros → tarjeta por lo que pagues (la
   "Pagar tarjeta" de la web). No es gasto: el gasto son las cuotas, los intereses y los cargos.
4. **Intereses del extracto:** un `EXPENSE` con la tarjeta, categoría `DEBT`, fecha de corte.
5. **Compras nuevas a cuotas** (después del ancla): `POST /installment-plans` con
   `"kind":"PURCHASE"`. Sube la deuda completa ese día; el gasto llega cuota a cuota.

```bash
curl -s "${H[@]}" "$API/installment-plans/pending" | jq '.[] | {description, n: "\(.number)/\(.installmentCount)", dueDate, principal, accountName}'
curl -s "${H[@]}" -X POST $API/installment-plans/pending/register -d '{}' | jq '.[] | {description, number, principal}'
```

## 7. Deshacer

| Qué | Cómo |
| --- | --- |
| Una cuota registrada | `DELETE /installment-plans/:id/installments/:n` |
| Un plan (sin cuotas registradas) | `DELETE /installment-plans/:id` |
| Una liquidación | `DELETE /installment-plans/:id/settle` |
| El ancla de una tarjeta | `POST /accounts/:id/balance-adjustments/:adjustmentId/revert` |
| El gasto fijo "Deuda celular" | `PATCH /recurring-expenses/:id` con `{"active":true}` |
| Todo | Restaurar el backup del paso 1 (`DEPLOY.md` §5.7) |

Revisión de solo lectura de las anclas:
`docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d cachifa_db -v ON_ERROR_STOP=1 < scripts/verify-card-anchor.sql`.
