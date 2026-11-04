# Diseño: tarjetas de crédito, cuotas, "Mis productos" y deudas propias

> Estado: **propuesta para decidir — versión 2**. No hay código ni migraciones todavía.
> Fecha: 2026-11-03. Repo: `my-cachifa-backend` (con impacto en `my-cashifa-web`).
>
> **Qué cambió respecto a la v1**
> - Nuevo §1: análisis de solo lectura de los datos reales (Paso 0).
> - §2 recoge las respuestas de Derek (TC VISA = cupo disponible, pagos registrados como `EXPENSE`, metas dentro de las cuentas) y los datos del extracto de octubre 2026.
> - B.5 (conversión de la TC VISA), B.6 (pagos del pasado) y B.7 (configuración de tarjeta) se reescriben.
> - Nuevas secciones D (cuotas) y E (Mis productos). **Cambia la recomendación de cuotas**: ya no "gasto completo el día de la compra", sino cuota a cuota (D.3).
> - El contrato de API, las fases, los riesgos y las preguntas pasan a F, G, H e I. La sección C (patrimonio) conserva su letra y queda confirmada.
> - Deudas propias (A) sigue válida pero pasa a fase 2: los datos muestran que hoy todas las deudas son de tarjeta.

## 0. Cómo está hoy (lo que condiciona el diseño)

| Pieza | Comportamiento actual | Dónde |
| --- | --- | --- |
| Saldo de una cuenta | `initialBalance` + (`INCOME`, `LOAN_REPAYMENT`) − (`EXPENSE`, `SAVING`, `DEBT_PAYMENT`, `LOAN_GIVEN`) con `accountId` de esa cuenta y fecha ≥ `initialBalanceDate`. Las transacciones sin cuenta no afectan ningún saldo | `src/modules/accounts/accounts.service.ts:15-26`, `:105-140` |
| `AccountType` | `DEBIT_CARD`, `CREDIT_CARD`, `CASH`, `SAVINGS_ACCOUNT`. Solo etiquetas: todas se calculan igual. No hay cupo, corte, pago, entidad ni vínculo cuenta ↔ tarjeta débito | `prisma/schema.prisma` (`AccountType`) |
| Ajuste de saldo | `PATCH /accounts/:id/initial-balance` `{ amount, date }` reemplaza el ancla (acepta negativos). No guarda el valor anterior | `accounts.service.ts:63-80`, `dto/update-initial-balance.dto.ts` |
| Ingreso del período | Solo `INCOME` | `src/modules/period-ledger/income-calculator.service.ts:19` |
| Gasto del período (ledger) | `EXPENSE` + `DEBT_PAYMENT` | `src/modules/period-ledger/period-ledger.service.ts:16-19` |
| Consumo de presupuesto | `EXPENSE` + `DEBT_PAYMENT`, por categoría | `src/modules/budgets/budget-recalculation.service.ts:21-24`, `:177` |
| Base del presupuesto | `openingBalance + ingresos − Σ estimatedAmount de los gastos fijos activos`; una categoría con gasto fijo tiene límite = Σ de sus `estimatedAmount` | `budget-recalculation.service.ts:70-100` |
| "Fijos por registrar" | `RecurringExpense` activos sin transacción enlazada en el período | `src/modules/recurring-expenses/recurring-expenses.service.ts:36-53` |
| Préstamos (patrón a imitar) | `Loan` + `LoanRepayment`, movimientos vinculados y bloqueados en `/transactions` (409) | `src/modules/loans/loans.service.ts`, `src/modules/expenses/transactions.service.ts` |
| Patrimonio neto | `accounts + receivables + goalsSavings + creditCardsAvailable − (debts + creditCardsDebt)`, con deudas y tarjetas fijas en 0 | `src/modules/net-worth/net-worth.service.ts:21-46` |

Dos consecuencias que importan:

1. Los filtros de ledger, presupuesto, ingreso y reportes son **listas de inclusión**. Un tipo de transacción nuevo (`TRANSFER`, `FINANCED_PURCHASE`) queda fuera de todos ellos sin tocarlos. Solo el cálculo de saldos tiene que aprenderlo.
2. El saldo se calcula desde un **ancla** (`initialBalance` a `initialBalanceDate`). Lo anterior al ancla sigue contando en ledger y presupuestos, pero no en el saldo. Esto es lo que permite cuadrar una tarjeta con su extracto sin duplicar movimientos (B.5).

---

## 1. Paso 0: cómo están registrados hoy los datos reales

Consulta de **solo lectura** sobre la base de producción (`cachifa_db`): sesión con `default_transaction_read_only=on` y cada bloque dentro de `BEGIN READ ONLY … ROLLBACK`. Solo agregados y las filas puntuales necesarias; no se modificó nada.

### 1.1 Panorama

- **173 transacciones** en total: 1 en julio, 37 en agosto, 126 en septiembre y 9 en octubre.
- **La última transacción se creó el 2026-10-02.** No hay nada registrado del 2 de octubre a hoy (un mes).
- 4 cuentas, todas con ancla el 2026-09-18:

| Cuenta | Tipo actual | Ancla | Movimientos | Saldo que calcula la app |
| --- | --- | --- | --- | --- |
| Ahorros Bancolombia | `DEBIT_CARD` | 5.199.379,32 | 164 | 14.810.463,22 |
| TC VISA Clásica | `CREDIT_CARD` | 1.766.523 | 6 | **1.007.408** |
| Efectivo | `CASH` | 0 | 1 | 0 |
| Nequi | `SAVINGS_ACCOUNT` | 1.968,34 | 0 | 1.968,34 |

- No existe ninguna transacción `DEBT_PAYMENT`, ni `SAVING`, ni etiquetas (`tags`). Hay 2 transacciones sin cuenta.

### 1.2 Movimientos de la TC VISA

- **6 `EXPENSE`, 908.515 en total**, del 2026-09-01 al 2026-10-02: gimnasio ×2 (`HEALTH`), Airbnb (`ENTERTAINMENT`), Claude (`SERVICES`) y 2 compras `CONTINGENCY`.
- 5 de ellas son posteriores al ancla: 1.766.523 − 759.115 = **1.007.408**. Confirma tu respuesta: el ancla fue el **cupo disponible** al 18/09 y cada compra lo descuenta.
- **Ningún movimiento ha subido nunca el saldo de la tarjeta**: ni un pago ni un abono. Por eso el "disponible" de la app solo baja.
- Dato útil: en el modelo de "disponible" las compras ya restan, igual que en el modelo de deuda. La diferencia entre ambos es solo el ancla.

### 1.3 Pagos de tarjeta registrados como gasto

Todas las transacciones con categoría `DEBT` (3 filas, 1.660.925) son `EXPENSE`:

| Fecha | Monto | Descripción | Cuenta | Gasto fijo vinculado | Qué es |
| --- | --- | --- | --- | --- | --- |
| 2026-09-01 | 1.065.695 | "TC Visa Bancolombia" | Ahorros Bancolombia | — | **Pago de la TC VISA registrado como gasto** |
| 2026-09-01 | 297.615 | "Gasto" | Ahorros Bancolombia | "Deuda celular" (`DEBT`, día 5) | Cuota del celular |
| 2026-10-02 | 297.615 | "pago tc davivienda" | (sin cuenta) | "Deuda celular" | Cuota del celular, pagada a la **TC Davivienda** |

- **Lo que parece pago de tarjeta registrado como gasto:** con seguridad, el de 1.065.695 del 1/09. Los dos de 297.615 también son pagos de tarjeta (Davivienda), pero de un celular cuya compra nunca se registró: ahí el pago es el **único** momento en que ese gasto aparece, así que **no** hay doble conteo.
- **Impacto hoy:** en el período 28 ago – 28 sep, el presupuesto `DEBT` (límite 297.615, viene del gasto fijo "Deuda celular") muestra 1.363.310 gastados (458 %), y el ledger de ese período cierra en −1.083.418.
- **¿El 1.065.695 cuenta dos veces?** Solo si las compras que pagó (las del extracto con corte 31/08) también están registradas como gasto. La tarjeta no tiene movimientos antes del 1/09. En agosto hay 34 `EXPENSE` (1.486.491), todos con la cuenta Ahorros y todos del 28 en adelante: si alguno fue en realidad una compra con la Visa, hay doble conteo parcial. Los datos no permiten saberlo del todo; se cerró como **historia** (§1.5, I.2).
- "Cuota de manejo" 14.900 (`OTHER`, gasto fijo "Cuota de Manejo Bancolombia Ahorros") es la cuota de la cuenta de ahorros, no de la tarjeta. La cuota de manejo de la Visa (30.900) no está registrada.

### 1.4 El abono de 838.675 del 04/10/2026 (caso de prueba)

**No está en la base.** No hay ninguna transacción de ese monto ni creada después del 2 de octubre. Siguiendo tu patrón habitual habría quedado como `EXPENSE`, categoría `DEBT`, cuenta Ahorros Bancolombia, y habría contado como gasto del período en curso y en el presupuesto `DEBT`. Con este diseño será un `TRANSFER` Ahorros → TC VISA (B.6).

Tampoco están las compras de octubre del extracto (2.314.058): la app solo tiene 104.900 con la tarjeta en ese ciclo (el gimnasio del 2/10).

### 1.5 Observación aparte (corregida)

La primera versión decía que el período "1 jul – 27 ago" tenía transacciones de agosto y aun así mostraba ingreso y gasto en 0. **Era un error:** las 37 transacciones de agosto son del 28 en adelante y caen en el período 28 ago – 28 sep. El período "1 jul – 27 ago" solo tiene el préstamo del 1 de julio (`LOAN_GIVEN`, que no es ingreso ni gasto), así que sus ceros son correctos. Además es el período de arranque, sin salario que lo abra, y por regla su ledger queda en 0. No hay nada que confirmar antes de un recálculo en cascada.

**Nota sobre el pago de 1.065.695 del 1/09 (§1.3, B.6):** la app no tiene nada registrado antes del 28 de agosto, y la tarjeta no tiene movimientos antes del 1/09. Por eso ese pago es, probablemente, el **único registro de las compras de agosto con la Visa**: no hay doble conteo. **Se deja como historia** (B.6, opción 1) y la pregunta I.2 queda cerrada.

---

## 2. Decisiones ya tomadas (respuestas de Derek y extracto de octubre)

| Tema | Decisión / dato |
| --- | --- |
| TC VISA +1.007.408 | Era el **cupo disponible**, no la deuda. Ese número está desactualizado y **no se usa** |
| Pagos de tarjeta hasta hoy | Registrados como `EXPENSE` (§1.3) |
| Pago de 1.065.695 del 1/09 | Probablemente el único registro de las compras de agosto con la Visa: **se deja como historia** (§1.5, B.6) |
| Metas | Están dentro de las cuentas: la corrección de C queda **confirmada** |
| Cuotas | Se configuran al registrar la compra con tarjeta (D) |
| Configuración de tarjeta | Cupo, corte, pago, cuota de manejo, tasa y similares (B.7) |
| Mis productos | Entidad + productos, con relaciones distintas por entidad (E) |

**Extracto TC VISA Bancolombia, corte 31/10/2026** (el dato fiable para la conversión):

| Concepto | Valor |
| --- | --- |
| Cupo total | 4.300.000 |
| Disponible | 0 (nunca negativo: la deuda supera el cupo en 239.024) |
| Deuda a la fecha de corte = pago total | 4.539.024 |
| Pago mínimo | 1.033.737 |
| Fecha límite | 17/11/2026 |
| Saldo anterior + compras + intereses corrientes + otros cargos (cuota de manejo) − abonos | 2.986.542,66 + 2.314.058 + 46.198,32 + 30.900 − 838.675 = **4.539.023,98** |
| Corte / pago | Fin de mes / alrededor del 17 del mes siguiente |
| Tasa | 1 cuota: 0 %. 2 a 36 cuotas: 2,1155 % mensual (28,5582 % EA) hoy. **Cada compra conserva la tasa del día en que se hizo** (abril 1,9915 %, mayo 2,0849 %, octubre 2,1155 %) |
| Cuota mostrada | Solo capital: monto / N (93.900 / 36 = 2.608,33). Los intereses se cobran aparte, cada mes, sobre el saldo financiado pendiente. **No es amortización francesa** |
| Ampliación de plazo | Refinanciación de 2.016.132,08 a 12 cuotas, va en la 7/12. No es una compra nueva ni un gasto |

---

## A. Deudas propias (dinero que yo debo) — fase 2

Sigue válido lo de la v1, con dos ajustes: (1) en producción no hay ninguna `DEBT_PAYMENT`, y (2) la única deuda que aparece en los datos ("Deuda celular") es en realidad una compra a cuotas con la **TC Davivienda**, que este diseño modela como tarjeta + plan de cuotas (D, E). Por eso el módulo de deudas pasa a fase 2: sirve para lo que **no** es tarjeta (un crédito de libre inversión, una deuda con una persona).

### A.1 Modelo (espejo de `Loan`)

```prisma
enum DebtStatus { ACTIVE  PARTIALLY_PAID  PAID }

model Debt {
  id                String        @id @default(cuid())
  userId            String
  creditorName      String        // "Crédito libre inversión", "Mamá"
  amount            Decimal       @db.Decimal(12, 2)  // saldo adeudado al registrarla (corregible)
  amountPaid        Decimal       @default(0) @db.Decimal(12, 2)
  status            DebtStatus    @default(ACTIVE)
  debtDate          DateTime
  dueDate           DateTime?
  installmentAmount Decimal?      @db.Decimal(12, 2)  // cuota de referencia (informativa)
  note              String?
  accountId         String?       // cuenta desde la que se paga por defecto
  payments          DebtPayment[]
  transactions      Transaction[]
}

model DebtPayment {
  id          String       @id @default(cuid())
  debtId      String       // onDelete: Cascade
  amount      Decimal      @db.Decimal(12, 2)
  paidAt      DateTime
  note        String?
  transaction Transaction? // su DEBT_PAYMENT
}

// En Transaction:
debtId        String?          // FK a Debt, onDelete: Cascade
debtPaymentId String? @unique  // FK a DebtPayment, onDelete: Cascade
```

`remainingAmount = amount − amountPaid`; estado con la misma regla que `loanStatusFor`. Los intereses se reflejan corrigiendo `amount` con el extracto (`PATCH`, nunca por debajo de `amountPaid`).

### A.2 Pagos

`POST /debts/:id/payments` crea en una `$transaction`: el `DebtPayment`, su `Transaction` `DEBT_PAYMENT` (`category: DEBT`, `debtId`, `debtPaymentId`), la actualización de `amountPaid` y `status`, y **la cascada de ledger y presupuestos** (`recalculateFrom(paidAt)`), porque `DEBT_PAYMENT` sí es gasto. Reglas: `paidAt ≥ debtDate` (día de Bogotá); no pagar más de lo pendiente (400); `DELETE /debts/:id/payments/:paymentId` deshace; `/transactions` responde 409 si `debtId != null`.

### A.3 Crear una deuda no mueve dinero

Por defecto solo anota lo que se debe. Si la deuda trae efectivo a una cuenta (crédito desembolsado), un `DEBT_RECEIVED` opcional sube la cuenta sin ser ingreso (fase 3).

### A.4 Regla general para no contar dos veces

**Cada peso de gasto se reconoce una sola vez**, en uno de estos momentos:

| Origen | Cuándo es gasto | El pago es… |
| --- | --- | --- |
| Compra de contado o débito | Al comprar (`EXPENSE`) | — |
| Compra con tarjeta a 1 cuota | Al comprar (`EXPENSE` con la tarjeta) | `TRANSFER` (no es gasto) |
| Compra con tarjeta a N cuotas | Cuota a cuota (D.3) | `TRANSFER` (no es gasto) |
| Deuda cuyo origen no se registró (crédito, deuda anterior a la app) | Al pagar (`DEBT_PAYMENT`) | Es el gasto |
| Intereses y cuota de manejo de la tarjeta | Cuando el extracto los cobra (`EXPENSE` con la tarjeta) | `TRANSFER` |

### A.5 Los `DEBT_PAYMENT` sueltos

No hay ninguno en producción. Los futuros sin deuda se permiten (`debtId = null`, editables desde `/transactions`).

---

## B. Tarjetas de crédito

### B.1 Transferencias (pieza común)

Pagar la tarjeta, sacar un avance y mover plata entre cuentas propias son el mismo concepto: **una transferencia entre dos cuentas propias**. Un tipo nuevo `TRANSFER` con columna `toAccountId`, en una sola fila:

- `accountId` = origen (resta), `toAccountId` = destino (suma).
- Fuera de ledger, presupuestos, ingresos y reportes sin tocar ese código. Solo `computeCurrentBalance` cambia.
- `category` se guarda como `OTHER` por convención; la UI no la muestra.
- "Pago de tarjeta" es una **etiqueta**: un `TRANSFER` cuyo destino es una `CREDIT_CARD`. "Avance" es un `TRANSFER` cuyo origen es una tarjeta.

### B.2 Diseño A (recomendado): la tarjeta es una `Account` de tipo `CREDIT_CARD`

Se mantiene la recomendación de la v1. El diseño B (modelo `CreditCard` aparte) obligaba a mover compras a otra columna, agregar `creditCardId` en préstamos, deudas y ahora planes de cuotas, y crear `TRANSFER` igual. Con "Mis productos" (E) el diseño A encaja aún mejor: una tarjeta es un producto más de una entidad.

**Convención de signo:** el saldo de una tarjeta configurada es **≤ 0 cuando se debe**.

- `debt = max(0, −currentBalance)`
- `available = max(0, creditLimit − debt)` → **nunca negativo**, como en el extracto.
- `overLimit = max(0, debt − creditLimit)` → "sobrecupo" (hoy 239.024).
- Saldo positivo = saldo a favor (activo).

**Tarjeta "sin configurar":** una `CREDIT_CARD` con `creditLimit = null` no tiene signo confiable (es el caso de la TC VISA hasta convertirla). Mientras esté así:
- Queda **fuera** de los totales del patrimonio y aparece en `info.unconfiguredCards` con un aviso.
- La web muestra "Configura esta tarjeta" en vez de "Debes / Disponible".

Esto permite desplegar el código antes de convertir los datos sin que el patrimonio muestre un número falso entre medio.

| Operación | Cómo se registra | Saldo de la tarjeta | Ledger / presupuesto |
| --- | --- | --- | --- |
| Compra a 1 cuota | `EXPENSE` con la tarjeta | baja (deuda sube, cupo baja) | Gasto al comprar |
| Compra a N cuotas | `FINANCED_PURCHASE` + plan (D) | baja por el **monto completo** | Gasto cuota a cuota |
| Pago a la tarjeta | `TRANSFER` cuenta → tarjeta | sube | Nada |
| Intereses del extracto | `EXPENSE` con la tarjeta, categoría `DEBT`, fecha de corte | baja | Gasto |
| Cuota de manejo | `EXPENSE` con la tarjeta (gasto fijo, B.7) | baja | Gasto |
| Avance | `TRANSFER` tarjeta → cuenta | baja | Nada |
| Ampliación de plazo | Plan `REFINANCE` sin transacción (D.5) | no cambia | Nada |

### B.3 Datos que faltan para la conversión de la TC VISA

Con el extracto de octubre ya están **todos**: cupo total 4.300.000 y deuda al corte 4.539.024 (31/10/2026). Faltan solo, y no bloquean, la tasa por defecto (2,1155 %) y la cuota de manejo (30.900 mensual, confirmar periodicidad).

### B.4 Conversión de la TC VISA ("cupo disponible" → saldo = −deuda)

**Idea:** mover el ancla al instante justo después del corte, con el valor del extracto. Todo lo anterior queda "dentro" del extracto y deja de afectar el saldo, pero sigue contando en ledger y presupuestos donde está. No se duplica nada y no se borra nada.

| | Antes | Después |
| --- | --- | --- |
| `initialBalance` | +1.766.523 (cupo disponible al 18/09) | **−4.539.024** (deuda del extracto; el resumen da 4.539.023,98, se usa el pago total para que pagarlo deje la tarjeta en 0) |
| `initialBalanceDate` | 2026-09-18 | **2026-11-01 00:00 Bogotá** (= `2026-11-01T05:00:00Z`) |
| `creditLimit` | — | 4.300.000 |
| `statementDay` / `paymentDueDay` | — | 31 (= último día del mes) / 17 |
| Saldo calculado | +1.007.408 | −4.539.024 + movimientos con fecha ≥ 1/11 |
| `debt` / `available` / `overLimit` | — | 4.539.024 / 0 / 239.024 |

**Por qué no se duplica:** las 6 compras registradas (del 1/09 al 2/10) quedan antes del ancla, así que no restan del saldo (ya están dentro del extracto). Siguen siendo gasto de sus períodos. Lo mismo vale para cualquier movimiento de octubre que registres después con su fecha real: un abono, una compra o los intereses del corte.

**Cómo hacerlo de forma segura y reversible:**

1. Backup del día verificado (`cachifa-backup run` + `scripts/restore-test.sh --remote` en verde). Hoy el último dump es del 18/09 (G.1).
2. Desplegar el paso 4 (tarjetas). La TC VISA queda "sin configurar" (fuera de los totales) hasta el paso 3.
3. Una sola llamada: `POST /accounts/:id/statement-balance` `{ cutDate: "2026-10-31", totalDebt: 4539024, creditLimit: 4300000 }`.
   - Es el **backend** el que calcula el ancla (`−totalDebt` al inicio del día siguiente al corte, en hora Bogotá). Así la web no tiene que saber de signos ni de zonas horarias.
   - Mandar `date: "2026-11-01"` al endpoint actual daría `00:00 UTC` = 31/10 19:00 Bogotá: una compra del 31/10 en la noche quedaría contada dos veces.
4. Cada cambio de ancla guarda el valor anterior en una tabla nueva `account_balance_adjustments` (`accountId`, `oldAmount`, `oldDate`, `newAmount`, `newDate`, `reason`, `createdAt`). Para revertir: `POST /accounts/:id/balance-adjustments/:adjustmentId/revert`, o `PATCH .../initial-balance` con los valores viejos (1.766.523 al 2026-09-18) y `creditLimit: null`.

**Cómo validarlo:**

- Script de solo lectura `prisma/verify-card-anchor.sql`, como el de préstamos. Por tarjeta:
  - El ancla.
  - El saldo calculado **a una fecha** (debe dar −4.539.024 al 31/10 23:59).
  - Los movimientos anteriores al ancla, solo como conteo informativo.
  - Los movimientos posteriores, que deberían ser solo los de noviembre.
- `GET /accounts`: `creditCard.debt = 4.539.024`, `available = 0`, `overLimit = 239.024`.
- **Conciliación mensual:** con el extracto de noviembre (corte 30/11), el saldo de la app al 30/11 debería coincidir con la deuda del extracto. La diferencia son movimientos sin registrar (compras, intereses, cuota de manejo). Si no se pueden encontrar, se vuelve a anclar con el nuevo extracto, y queda registrado en el historial.

**Opcional, recomendado:** registrar como `EXPENSE` con fecha 31/10 los intereses (46.198,32, `DEBT`) y la cuota de manejo (30.900) del corte de octubre. Por quedar antes del ancla no cambian el saldo de la tarjeta, pero sí aparecen como gasto del período (I.3).

### B.5 Las otras cuentas

Ahorros Bancolombia también está anclada al 18/09 y no tiene movimientos desde el 2/10: su saldo (14.810.463,22) seguramente ya no coincide con el banco. El mismo mecanismo de ancla, con el saldo del banco a una fecha, la pone al día. No es parte de este diseño, pero conviene hacerlo en el mismo momento.

### B.6 Pagos de tarjeta del pasado registrados como `EXPENSE`

Afecta a **una fila** (1.065.695, 2026-09-01). Los 2 pagos de "Deuda celular" no se tocan (§1.3).

| Opción | Qué se hace | Ledger y presupuestos pasados | Saldos de cuentas |
| --- | --- | --- | --- |
| 1. Dejarlos como historia | Nada | Sin cambios: período 28 ago – 28 sep sigue con gasto 10.852.468, cierre −1.083.418 y `DEBT` al 458 % | Sin cambios |
| 2. Convertirlos a `TRANSFER` | Borrar el `EXPENSE` y crear `TRANSFER` Ahorros → TC VISA del 1/09 (desde la API, después del paso 2) | 28 ago – 28 sep: gasto 9.786.773, cierre −17.723, `DEBT` 297.615 (100 %). En cascada, el período actual abre 1.065.695 más arriba (cierre 5.167.948,90 → 6.233.643,90) y su base de presupuesto sube igual, así que los límites porcentuales actuales **suben** | Sin cambios: el 1/09 queda antes de ambas anclas (Ahorros 18/09, tarjeta 1/11) |
| 3. Marcarlos | Etiqueta `pago-tarjeta` en `tags` (columna que ya existe, hoy vacía) | Sin cambios; la web puede mostrarlos apartados ("pago de tarjeta antiguo") | Sin cambios |

**Decidido: opción 1** (dejarla como historia, §1.5). Marcarla (opción 3) queda opcional para la fase 2. Es una sola fila. Probablemente pagó compras de agosto o anteriores que la app no tiene con la tarjeta, y en ese caso el gasto no está duplicado: ese pago es el único registro de esas compras. Convertirla haría perder ese gasto y movería los presupuestos del período actual.

Solo si confirmas que las compras de la Visa de agosto **sí** están registradas (I.2), se convierte esa fila a mano por la API (opción 2). Es reversible con la operación inversa y no justifica una migración.

**Regla desde la puesta en marcha (paso 2):** todo pago de tarjeta es `TRANSFER`. Esto incluye el pago del 17/11/2026 y el abono de 838.675 del 04/10 si lo registras: **no lo registres como gasto** mientras no exista `TRANSFER`. Como ayuda opcional, la web sugiere "¿Es un pago de tarjeta?" al crear un `EXPENSE` de categoría `DEBT` desde una cuenta de ahorros.

### B.7 Configuración de tarjeta

| Campo | Tipo | Para qué se usa | Fase |
| --- | --- | --- | --- |
| `creditLimit` | Decimal | `available`, `overLimit`, "configurada" | **MVP** |
| `statementDay` | Int 1–31 (31 = último día del mes, se ajusta a meses cortos) | Fecha de corte: a qué extracto va cada compra y cada cuota | **MVP** |
| `paymentDueDay` | Int 1–31 (del mes siguiente al corte) | Fecha de pago: cuándo vence cada cuota (D.3) y "próximo pago" | **MVP** |
| `defaultMonthlyRate` | Decimal(7,4), % mensual | Valor por defecto de la tasa de un plan nuevo. La respuesta incluye la EA calculada: `(1 + m)^12 − 1` (2,1155 % → 28,558 %). Si te dan la EA: `m = (1 + EA)^(1/12) − 1` | **MVP** |
| `handlingFee` + `handlingFeePeriodicity` (`MONTHLY`, `QUARTERLY`, `ANNUAL`) | Decimal + enum | Cuota de manejo | Fase 2 (ver abajo) |
| `cardLast4` | String(4) | Identificar la tarjeta | MVP (va con E) |
| Pago mínimo, avances con tasa propia, seguro de deudores | — | — | Más adelante |

**¿Para qué sirve la tasa?** Para **estimar**, no para contabilizar:
- El costo de financiación de una compra al registrarla: "a 36 cuotas te cuesta ≈ 36.749 en intereses" (D.2).
- Los intereses esperados del próximo extracto.

El interés **real** es el que cobra el extracto, y se registra como gasto con la tarjeta. La app nunca genera intereses por su cuenta en el MVP.

**¿La cuota de manejo se genera sola?** Sí, como gasto fijo, pero en fase 2:
- La configuración de la tarjeta crea o actualiza un `RecurringExpense` "Cuota de manejo TC VISA" (`OTHER`, como la de la cuenta de ahorros).
- Ese gasto fijo tiene una columna nueva `accountId`, para que al registrarlo desde "Fijos por registrar" quede con la tarjeta y suba la deuda.

**En el MVP** se hace a mano con lo que ya existe: crear el gasto fijo "Cuota de manejo TC VISA", 30.900, día 31, y elegir la tarjeta como cuenta al registrarlo.

---

## C. Patrimonio neto — corrección confirmada

### C.1 El doble conteo de metas

- `src/modules/net-worth/net-worth.service.ts:22` suma el saldo de todas las cuentas (`getTotalBalance`).
- `net-worth.service.ts:27-30` y `:36` suman `Goal.currentAmount` de todas las metas.
- `net-worth.service.ts:42-45` los suma en `totalAssets` (línea 44: `.plus(goalsSavings)`).

Un aporte a meta no es una transacción (`src/modules/goals/goals.service.ts:131-140`), igual que el "Ya ahorrado" inicial (`goals.service.ts:55`). El dinero sigue en la cuenta.

**Ejemplo:** cuenta de ahorros con 5.000.000; meta "Carro" con 2.000.000 ya ahorrados más un aporte de 500.000, todo en esa cuenta. Hoy: 5.000.000 + 2.500.000 = **7.500.000**. Real: **5.000.000**.

### C.2 Corrección (confirmada por Derek)

Las metas son **apartados** dentro del dinero de las cuentas. `goalsSavings` pasa a `info`, fuera de la suma. Si una meta se ahorra fuera de las cuentas registradas (un CDT), se registra como producto (E).

### C.3 Campos

| Campo | Fórmula |
| --- | --- |
| `assets.accountsBalance` | Σ saldo de cuentas que no son tarjeta + Σ saldos a favor de tarjetas configuradas |
| `assets.receivables` | Igual que hoy |
| `liabilities.creditCardsDebt` | Σ `debt` de las tarjetas **configuradas**. Incluye el capital pendiente de todas las cuotas: el banco ya lo cuenta en la deuda |
| `liabilities.debts` | Σ pendiente de `Debt` no pagadas (0 hasta la fase 2) |
| `info.creditCardsAvailable` | Σ `available`. **No es activo** (hoy está en `assets`, `net-worth.service.ts:45`) |
| `info.goalsSavings` | Σ `currentAmount` |
| `info.unconfiguredCards` | Tarjetas sin `creditLimit`, fuera de los totales, con aviso |
| `netWorth` | `accountsBalance + receivables − creditCardsDebt − debts` |

```json
{
  "assets": { "accountsBalance": 0, "receivables": 0 },
  "liabilities": { "creditCardsDebt": 0, "debts": 0 },
  "info": { "goalsSavings": 0, "creditCardsAvailable": 0, "unconfiguredCards": [] },
  "totals": { "assets": 0, "liabilities": 0 },
  "netWorth": 0
}
```

**Efecto visible con tus datos:**
- **Paso 1:** el patrimonio baja en el total de tus metas, y los +1.007.408 de la TC VISA dejan de sumar, porque la tarjeta queda "sin configurar".
- **Paso 4:** después de la conversión aparece la deuda de 4.539.024.

En total, la TC VISA pasa de sumar +1.007.408 a restar 4.539.024, un cambio de −5.546.432. Es el número correcto, pero hay que explicarlo en la pantalla. Web: `features/net-worth/lib/netWorthView.ts:15-22`.

---

## D. Cuotas de tarjeta

### D.1 Cómo cobra el banco (el modelo a reproducir)

- La compra entera consume cupo y es deuda desde el día uno: el pago total del extracto la incluye.
- Cada mes el extracto factura **una cuota de capital** = monto / N (constante; la última absorbe el redondeo).
- Además cobra **intereses corrientes** sobre el capital financiado pendiente, a la tasa fija del plan.
- No es amortización francesa: la "cuota" que ves es solo capital y baja el total mes a mes.

**Ejemplo real:** 93.900 a 36 cuotas al 2,1155 % mensual.

| Cuota | Capital | Capital pendiente antes de la cuota | Interés estimado |
| --- | --- | --- | --- |
| 1 | 2.608,33 | 93.900,00 | 1.986,45 |
| 2 | 2.608,33 | 91.291,67 | 1.931,28 |
| … | … | … | … |
| 36 | 2.608,45 | 2.608,45 | 55,18 |
| **Total** | **93.900** | | **≈ 36.749** (`P × r × (N + 1) / 2`) |

El interés de la cuota 1 es una aproximación de mes completo (el banco cuenta desde el día de la compra). Todo interés del plan es una **estimación**; el real lo dice el extracto.

### D.2 Modelo

```prisma
enum InstallmentPlanKind   { PURCHASE  REFINANCE  LEGACY }
enum InstallmentPlanStatus { ACTIVE  FINISHED  SETTLED }

model InstallmentPlan {
  id                    String   @id @default(cuid())
  userId                String
  accountId             String                 // the CREDIT_CARD account
  kind                  InstallmentPlanKind
  description           String                 // "Portátil", "Ampliación de plazo"
  category              Category?              // what was bought (reports); null for REFINANCE
  principal             Decimal  @db.Decimal(12, 2)
  installmentCount      Int                    // 2..48
  monthlyRate           Decimal  @db.Decimal(7, 4)  // % per month, fixed for this plan
  startDate             DateTime               // purchase or refinance date
  firstStatementDate    DateTime               // statement that bills installment 1
  billedBeforeTracking  Int      @default(0)   // installments billed before the app knew the plan (6 for "7/12")
  recognizeInstallments Boolean                // do installments count as expense?
  status                InstallmentPlanStatus @default(ACTIVE)
  settledAt             DateTime?              // paid off early
  transactions          Transaction[]          // its FINANCED_PURCHASE + recognized installments
}

// In Transaction:
installmentPlanId String?  // FK, onDelete: Cascade
installmentNumber Int?     // null on the FINANCED_PURCHASE row
@@unique([installmentPlanId, installmentNumber])

// TransactionType: new value FINANCED_PURCHASE
```

| Tipo de plan | Se crea con | Movimiento que afecta la tarjeta | ¿Cuotas como gasto? (default) |
| --- | --- | --- | --- |
| `PURCHASE` | Una compra nueva a N cuotas | `FINANCED_PURCHASE` por el monto completo | Sí |
| `LEGACY` | Una compra anterior al ancla que ya está en el extracto (p. ej. las de abril y mayo) | Ninguno: ya está dentro del ancla | Sí si la compra **no** está registrada en la app; no si ya está como `EXPENSE` (Sep–Oct) |
| `REFINANCE` | Ampliación de plazo | Ninguno: reestructura deuda que ya existía | No (lo dijiste: no es gasto; ver I.8) |

**Calendario (calculado, no guardado):**
- La cuota *k* se factura en el corte `firstStatementDate + (k − 1)` meses.
- **Vence** en el `paymentDueDay` del mes siguiente a ese corte.
- `firstStatementDate` por defecto es el primer corte ≥ fecha de compra. Se puede corregir si el banco la manda al siguiente.
- Capital pendiente = `principal − capital de las cuotas ya facturadas`, contando las `billedBeforeTracking`.
  - Ejemplo, ampliación: 2.016.132,08 / 12 = 168.011,01 por cuota. Con 6 facturadas, quedan 1.008.066,02.

### D.3 Cómo se reconoce: deuda y cupo vs. gasto del presupuesto

**(a) Deuda y cupo de la tarjeta.** Siempre por el **monto completo el día de la compra**, como el banco. Con eso, el saldo de la app coincide con el "pago total" del extracto, y el cupo disponible también.

**(b) Gasto del presupuesto y del ledger.** Dos opciones:

| | 1. Completo el día de la compra (recomendación v1) | 2. Cuota a cuota, en el período en que vence |
| --- | --- | --- |
| Compra a N cuotas | `EXPENSE` del monto completo con la tarjeta | `FINANCED_PURCHASE` del monto completo (baja la tarjeta, **no** es gasto) |
| Cada cuota | Nada | Un `EXPENSE` de la cuota de capital, **sin cuenta** (no toca saldos: la deuda ya subió), `category: DEBT`, fecha = vencimiento, vinculado al plan |
| Ejemplo: portátil de 3.600.000 a 36 cuotas | El período de la compra pierde 3.600.000. Ese cierre negativo pasa como apertura del siguiente y **baja la base del presupuesto del siguiente** en 3.600.000, aunque de la cuenta de ahorros no salió nada | 100.000 en cada uno de 36 períodos, que es lo que de verdad sale cada mes |
| El ledger se parece a… | Al patrimonio: la deuda cuenta como gasto | Al flujo de caja: lo que sale cada mes |
| Complejidad | Ninguna nueva | Tipo nuevo, cuotas vinculadas, pendientes y base del presupuesto |
| Compras pequeñas (93.900 / 36) | Se ve completo, aunque el mes solo pagas 2.608 | 2.608,33 por período durante 3 años |

**Recomiendo la opción 2 para compras de 2 o más cuotas** (la compra a 1 cuota sigue siendo gasto al comprar). Cambia la recomendación de la v1, por cómo funciona la base del presupuesto: con la opción 1, una compra grande a cuotas deja un cierre negativo que pasa al período siguiente y deja los presupuestos porcentuales en 0 durante meses, aunque el dinero siga en la cuenta. La opción 2 mantiene la promesa del presupuesto: "lo que puedo gastar este período".

**Por qué la cuota va sin cuenta:**
- Si llevara la tarjeta como cuenta, restaría otra vez de la tarjeta (doble deuda). Si llevara la cuenta de ahorros, restaría dinero que en realidad sale con el `TRANSFER` del pago.
- "Sin cuenta" ya es un estado válido (hay 2 hoy).
- La fila queda **bloqueada** en `/transactions` (409, como los préstamos), así que nadie le puede poner una cuenta después.

**Por qué categoría `DEBT`:**
- El límite de `DEBT` pasa a ser Σ gastos fijos `DEBT` + Σ cuotas del período, sin mezclar cuotas con las reglas porcentuales de otras categorías.
- La categoría original de la compra queda en el plan, para reportes de "en qué gasté" (I.5).

### D.4 Pendientes, "Fijos por registrar" y presupuesto

- **Base del presupuesto:** a la resta de gastos fijos se suma la de las **cuotas de capital que vencen en el período** (de planes con `recognizeInstallments`), registradas o no. Así el presupuesto ya cuenta con ellas desde el primer día, igual que con un arriendo.
- **"Fijos por registrar"** suma un grupo **"Cuotas de tarjeta"** (`GET /installment-plans/pending?periodId=`): cada cuota que vence en el período y no se ha reconocido. Muestra "Portátil · cuota 3/36 · 100.000 · vence 17 nov · TC VISA" y el interés estimado aparte, como dato.
  - Botones: **"Registrar"** (una) y **"Registrar todas"** (las del período), que crean las filas `EXPENSE` vinculadas.
  - MVP manual, como los gastos fijos. Automático al vencer, en fase 2.
- **Cuotas futuras:** no se crean filas futuras, porque los períodos se abren con cada salario y aún no existen.
  - Se ven en el detalle de la tarjeta ("Plan de cuotas": cuota actual, pendientes y capital restante) y en un resumen "Próximos meses" por mes de vencimiento.
  - Cuando el período llega a ser el actual, aparecen en pendientes.
- **Liquidar un plan** (pagaste el total del extracto o hiciste abono a capital): `POST /installment-plans/:id/settle` reconoce de una vez el capital restante como una cuota final y pasa el plan a `SETTLED`. Entra al MVP porque es pequeño y sin él las cuotas seguirían saliendo en pendientes.

### D.5 Ampliación de plazo y planes existentes

- **Ampliación (`REFINANCE`):** principal 2.016.132,08, 12 cuotas, `billedBeforeTracking = 6`, tasa (dato que falta, I.9), `recognizeInstallments = false`.
  - No crea transacción ni cambia la deuda: ese saldo ya está dentro del ancla.
  - Sirve para ver el calendario, el capital restante y el interés estimado. Sus intereses reales llegan con el extracto, como cualquier interés.
- **Compras a cuotas anteriores** que aparecen en el extracto (abril, mayo, …): se registran como `LEGACY`, con su tasa y cuántas cuotas van. No crean transacción.
- **Lo que no se hace:** convertir los `EXPENSE` ya registrados (Sep–Oct) en `FINANCED_PURCHASE`. Cambiaría ledger y presupuestos de períodos pasados. Si alguno era a cuotas, se registra como `LEGACY` con `recognizeInstallments = false`.

### D.6 Reglas

- `FINANCED_PURCHASE` y las cuotas reconocidas solo se crean, editan y borran desde `/installment-plans`. `/transactions` responde 400 al crear el tipo y 409 al editar o borrar esas filas.
- Editar un plan con cuotas reconocidas: solo `description`, `category` y `monthlyRate`. Para cambiar monto, número de cuotas o fechas hay que deshacer antes las cuotas reconocidas (como `loanDate` con los abonos).
- `DELETE` de un plan con cuotas reconocidas → 400 (primero se deshacen). Sin cuotas reconocidas se borra con su `FINANCED_PURCHASE` (cascade) y recalcula.
- Reconocer o deshacer una cuota recalcula en cascada desde su fecha. Crear una compra a cuotas no toca el ledger: solo el saldo de la tarjeta y la base del presupuesto de los períodos donde vencen sus cuotas.

---

## E. "Mis productos"

### E.1 Modelo

Una **entidad** (Bancolombia, Nequi, Davivienda) tiene **productos**. Un producto donde vive dinero o deuda sigue siendo una `Account`. La **tarjeta débito no es una cuenta**: no tiene saldo propio, es un medio de pago sobre una cuenta. Por eso es un atributo de la cuenta, no otra `Account`.

Cambios mínimos, todos aditivos:

```prisma
model FinancialInstitution {
  id        String    @id @default(cuid())
  userId    String
  name      String    // "Bancolombia"
  accounts  Account[]
  // @@unique([userId, name])
}

// In Account:
institutionId String?  // null = no institution (cash)
hasDebitCard  Boolean  @default(false)
cardLast4     String?  // debit or credit card
// + B.7 credit card fields: creditLimit, statementDay, paymentDueDay, defaultMonthlyRate

// AccountType: add CHECKING_ACCOUNT, DIGITAL_WALLET. DEBIT_CARD stays in the enum
// (Postgres cannot drop values easily) but is rejected on create/update.
```

¿Tabla de entidades o un texto en la cuenta? Tabla. Es una tabla mínima, permite renombrar una vez y agrupar sin errores de escritura, y queda lista para un logo o color más adelante. Un texto libre (`institution: "Bancolombia"`) también funcionaría (I.11).

### E.2 Casos obligatorios

| Entidad | Productos | Cómo queda |
| --- | --- | --- |
| Bancolombia | Cuenta de ahorros con tarjeta débito + TC Visa | `Account` `SAVINGS_ACCOUNT` (`hasDebitCard = true`, `cardLast4`) y `Account` `CREDIT_CARD`, ambas con `institutionId` = Bancolombia |
| Nequi | Billetera sin tarjeta | `Account` `DIGITAL_WALLET`, `hasDebitCard = false` |
| Davivienda | Solo tarjeta de crédito | `Account` `CREDIT_CARD` sin ninguna cuenta hermana. Es lo que paga hoy "Deuda celular" |
| (sin entidad) | Efectivo | `Account` `CASH`, `institutionId = null` |

Un pago con débito se registra con `accountId` = la cuenta de ahorros: la tarjeta débito no cambia ningún cálculo.

### E.3 Migrar las cuentas actuales (por la API, con backup previo)

| Cuenta | Hoy | Después |
| --- | --- | --- |
| Ahorros Bancolombia | `DEBIT_CARD` | `SAVINGS_ACCOUNT` + `hasDebitCard` + Bancolombia |
| TC VISA Clásica | `CREDIT_CARD` | Bancolombia + configuración + conversión (B.4) |
| Nequi | `SAVINGS_ACCOUNT` | `DIGITAL_WALLET` + Nequi |
| Efectivo | `CASH` | Sin cambios |
| TC Davivienda | (no existe) | Nueva `CREDIT_CARD` anclada a su último extracto + plan `LEGACY` del celular; desactivar el gasto fijo "Deuda celular" para no restarlo dos veces de la base del presupuesto (I.10) |

Son 4 cuentas: se hace con `PATCH /accounts/:id` desde la web, no con SQL. El cambio de tipo entre no-tarjetas no afecta ningún cálculo. Pasar **a** o **desde** `CREDIT_CARD` una cuenta con movimientos se rechaza con 400, porque cambia el significado del signo.

### E.4 Endpoints y lo que ve la web

- `GET/POST/PATCH/DELETE /institutions` (`DELETE` → 400 si tiene productos).
- `PATCH /accounts/:id` (nuevo): `name`, `type` (con la regla de arriba), `institutionId` (`null` desliga), `hasDebitCard`, `cardLast4` y los campos de tarjeta.
- `GET /accounts`: cada cuenta suma `institution: { id, name } | null`, `hasDebitCard`, `cardLast4` y `creditCard` (F.2). La web agrupa; no hace falta un `/products` aparte.

**Pantalla "Mis productos"** (reemplaza la lista de cuentas en Ajustes):
- Agrupada por entidad, y "Sin entidad" al final.
- Cuenta: saldo y "Tarjeta débito •••• 1234".
- Billetera: saldo.
- Tarjeta de crédito: "Debes 4.539.024 · Disponible 0 · Sobrecupo 239.024 · Cupo 4.300.000", "Corte 31 · Pago 17 nov", "Plan de cuotas (n activos)" y las acciones **Pagar tarjeta**, **Compra a cuotas** y **Ajustar al extracto**.
- Tarjeta sin configurar: "Configura esta tarjeta".
- "Agregar producto": entidad (existente o nueva) → tipo → datos según el tipo.

---

## F. Contrato de API

Prefijo `/api/v1`, `x-api-key`, errores con la forma del `HttpExceptionFilter`.

### F.1 Transferencias

| Método y ruta | Cambio |
| --- | --- |
| `POST /transactions` | `type: 'TRANSFER'` exige `accountId` y `toAccountId` distintos y del usuario; `category` se ignora (`OTHER`); sin `recurringExpenseId`. `type: 'FINANCED_PURCHASE'` → 400 ("Financed purchases are created from /installment-plans") |
| `PATCH /transactions/:id` | En un `TRANSFER`: `amount`, `transactionDate`, `accountId`, `toAccountId`, `description`. No cambia de tipo (400). Filas con `installmentPlanId` → 409 |
| `GET /transactions` | `toAccountId` / `toAccount`, `installmentPlanId`, `installmentNumber` |

### F.2 Productos y tarjetas

| Método y ruta | Body | Respuesta |
| --- | --- | --- |
| `GET /institutions` | — | `{ id, name, accountCount }[]` |
| `POST /institutions` | `{ name }` | institución (409 si el nombre ya existe) |
| `PATCH /institutions/:id` | `{ name }` | institución |
| `DELETE /institutions/:id` | — | 204; 400 si tiene productos |
| `POST /accounts` | Suma `institutionId?`, `hasDebitCard?`, `cardLast4?`, y para `CREDIT_CARD`: `creditLimit?`, `statementDay?`, `paymentDueDay?`, `defaultMonthlyRate?` | `IAccountResponse` |
| `PATCH /accounts/:id` | Los mismos, opcionales, más `name`, `type` | `IAccountResponse` |
| `POST /accounts/:id/statement-balance` | `{ cutDate, totalDebt, creditLimit? }` (solo tarjetas) | `IAccountResponse` + `adjustmentId` |
| `PATCH /accounts/:id/initial-balance` | Igual que hoy; ahora también deja un registro en `account_balance_adjustments` | `IAccountResponse` |
| `GET /accounts/:id/balance-adjustments` | — | historial de anclas |
| `POST /accounts/:id/balance-adjustments/:adjustmentId/revert` | — | `IAccountResponse` |

```ts
interface IAccountResponse {
  // existing fields…
  institution: { id: string; name: string } | null;
  hasDebitCard: boolean;
  cardLast4: string | null;
  creditCard: null | {
    configured: boolean;            // creditLimit != null
    creditLimit: number | null;
    statementDay: number | null;
    paymentDueDay: number | null;
    defaultMonthlyRate: number | null;
    defaultEffectiveAnnualRate: number | null;
    debt: number; available: number; overLimit: number;
    nextStatementDate: string | null; nextPaymentDate: string | null;
    activePlans: number; remainingInstallmentPrincipal: number;
  };
}
```

### F.3 Cuotas

| Método y ruta | Body | Respuesta |
| --- | --- | --- |
| `POST /installment-plans` | `{ accountId, kind, description, category?, principal, installmentCount, monthlyRate?, startDate, firstStatementDate?, billedBeforeTracking?, recognizeInstallments? }`. `PURCHASE` crea el `FINANCED_PURCHASE`; `monthlyRate` por defecto = el de la tarjeta | `IInstallmentPlanDetail` |
| `GET /installment-plans?accountId=&status=` | — | `IInstallmentPlan[]` |
| `GET /installment-plans/:id` | — | `IInstallmentPlanDetail` (con calendario) |
| `PATCH /installment-plans/:id` | Reglas de D.6 | `IInstallmentPlanDetail` |
| `DELETE /installment-plans/:id` | — | 204; 400 si tiene cuotas reconocidas |
| `GET /installment-plans/pending?periodId=` | — | `IPendingInstallment[]` |
| `POST /installment-plans/:id/installments/:number` | — (reconoce una) | `IInstallmentPlanDetail` |
| `POST /installment-plans/pending/register` | `{ periodId? }` (todas las del período) | `IPendingInstallment[]` registradas |
| `DELETE /installment-plans/:id/installments/:number` | — (deshace) | `IInstallmentPlanDetail` |
| `POST /installment-plans/:id/settle` | `{ settledAt? }` | `IInstallmentPlanDetail` |

```ts
interface IInstallmentPlan {
  id: string; accountId: string; kind: 'PURCHASE' | 'REFINANCE' | 'LEGACY';
  description: string; category: string | null;
  principal: number; installmentCount: number; monthlyRate: number; effectiveAnnualRate: number;
  startDate: string; firstStatementDate: string; billedBeforeTracking: number;
  recognizeInstallments: boolean; status: 'ACTIVE' | 'FINISHED' | 'SETTLED';
  installmentAmount: number;           // principal / count
  currentInstallment: number;          // e.g. 7 of 12
  remainingPrincipal: number;
  estimatedRemainingInterest: number;
}
interface IInstallmentPlanDetail extends IInstallmentPlan {
  schedule: {
    number: number; statementDate: string; dueDate: string;
    principal: number; estimatedInterest: number;
    state: 'BILLED_BEFORE_TRACKING' | 'RECOGNIZED' | 'PENDING' | 'FUTURE' | 'NOT_RECOGNIZED';
    transactionId: string | null;
  }[];
}
interface IPendingInstallment {
  planId: string; number: number; installmentCount: number;
  description: string; accountId: string; dueDate: string;
  principal: number; estimatedInterest: number;
}
```

### F.4 Patrimonio y deudas

- `GET /net-worth`: la forma de C.3.
- Deudas (fase 2): igual que en la v1 (`GET/POST /debts`, `GET/PATCH/DELETE /debts/:id`, `POST /debts/:id/payments`, `DELETE /debts/:id/payments/:paymentId`; `IDebtResponse` con `remainingAmount` y `status`; 409 en `/transactions` si `debtId != null`).

---

## G. Fases y orden de implementación

### G.1 Regla para toda migración y corrección de datos

Antes de cada `prisma migrate deploy` en producción, y antes de cada corrección de datos (B.4, B.6, E.3), **el mismo día**:

1. `docker compose -f docker-compose.prod.yml exec backup cachifa-backup run`, y `status` en `ok`.
2. `scripts/restore-test.sh --remote` en verde.
3. `prisma migrate status` muestra solo las migraciones esperadas como pendientes.

**Hoy esto bloquea todo:** el servicio de backup no está configurado y el último dump es del **2026-09-18**.

Además:
- Toda migración es **aditiva**: tablas, columnas nulas o con default, valores de enum nuevos. El código anterior sigue funcionando con la base migrada.
- Ningún dato se corrige por SQL. Todo pasa por la API, que deja historial (`account_balance_adjustments`) y recalcula en cascada.
- Los valores de enum se agregan solo cuando se deciden (`ALTER TYPE … ADD VALUE` no se deshace fácil).

### G.2 MVP (fase 1)

| Paso | Qué entra | Migración | Datos reales | Web |
| --- | --- | --- | --- | --- |
| **0** | Backup operativo y verificado; respuestas de I | — | — | — |
| **1** | Patrimonio sin doble conteo; tarjeta sin `creditLimit` = "sin configurar", fuera de los totales | Ninguna | — | `netWorthView.ts`, texto explicativo |
| **2** | `TRANSFER` (pagos de tarjeta, avances, entre cuentas) | Enum `TRANSFER`; `transactions.to_account_id` | Desde aquí, los pagos de tarjeta se registran como `TRANSFER` (opcional: el 838.675 del 04/10) | Formulario de transferencia / "Pagar tarjeta" |
| **3** | Mis productos | Tabla `financial_institutions`; `accounts.institution_id`, `has_debit_card`, `card_last4`; enum `CHECKING_ACCOUNT`, `DIGITAL_WALLET` | Reclasificar las 4 cuentas (E.3) | Pantalla "Mis productos" |
| **4** | Tarjetas | `accounts.credit_limit`, `statement_day`, `payment_due_day`, `default_monthly_rate`; tabla `account_balance_adjustments` | **Conversión de la TC VISA** (B.4) + `verify-card-anchor.sql`; opcional: intereses y cuota de manejo de octubre (B.4) y el ancla de Ahorros (B.5) | Tarjeta en Mis productos, "Ajustar al extracto", patrimonio con deuda |
| **5** | Cuotas | Tabla `installment_plans` + enums; `transactions.installment_plan_id`, `installment_number` (único compuesto); enum `FINANCED_PURCHASE` | Registrar planes `LEGACY` / `REFINANCE` del extracto; TC Davivienda y su plan; desactivar "Deuda celular" | "Compra a cuotas", plan de cuotas, grupo en "Fijos por registrar", "Próximos meses" |

Cada paso se despliega solo y deja la app consistente. El paso 1 no depende de ningún otro. Los pasos 2 a 5 van en orden. Si el 17/11 llega antes del paso 2, el pago se registra después, con su fecha real.

**Tests mínimos por paso:**
- 1: el ejemplo de C.1 y una tarjeta sin configurar.
- 2: los saldos no cambian sin transferencias, y origen/destino.
- 4: el ancla con `cutDate` en hora Bogotá, `available` nunca negativo, `overLimit`, el historial y la reversión.
- 5: el calendario (93.900 / 36), los vencimientos con corte a fin de mes y meses cortos, la base del presupuesto, el 409, liquidar, y que `REFINANCE`/`LEGACY` no toquen el saldo.

### G.3 Fase 2

- Deudas propias (A).
- Cuota de manejo automática (`handlingFee` en la tarjeta + `RecurringExpense.accountId`).
- Reconocimiento automático de cuotas al vencer.
- **"Registrar extracto"**: un formulario con intereses, cuota de manejo y otros cargos, que muestra la diferencia con el saldo de la app y ofrece re-anclar.
- Alertas de fecha de pago y de sobrecupo.
- Etiqueta del pago antiguo (B.6) y aviso "¿Es un pago de tarjeta?".

### G.4 Fase 3

- `DEBT_RECEIVED` (desembolsos).
- Aportes a metas como `TRANSFER` a una cuenta de ahorro ligada.
- Reemplazar `SAVING` por transferencias.
- Interés estimado automático en "Próximos meses".
- App móvil.

---

## H. Riesgos para los datos reales

| Riesgo | Mitigación |
| --- | --- |
| **No hay backup reciente** (último dump 18/09) | Paso 0 obligatorio; nada se migra ni se corrige sin backup del día verificado (G.1) |
| **Signo de la TC VISA** durante la transición | Tarjeta "sin configurar" fuera de los totales hasta la conversión; conversión en una sola llamada con el extracto; historial y reversión |
| **Ancla mal ubicada** (zona horaria) | El backend calcula el instante desde `cutDate` en hora Bogotá; `verify-card-anchor.sql` compara contra el extracto |
| **Datos incompletos**: no hay nada registrado desde el 2/10 | El ancla hace que la tarjeta cuadre igual; lo que se registre después con fecha anterior al ancla no la descuadra. Ledger y presupuestos del período actual seguirán incompletos hasta que lo registres |
| **El patrimonio baja de golpe** (metas, más −5.546.432 por la TC VISA) | Explicarlo en la UI y en las notas de despliegue |
| **Doble resta en la base del presupuesto** si una deuda queda a la vez como gasto fijo y como plan (el caso "Deuda celular") | Al crear el plan, la web avisa si hay un gasto fijo `DEBT` con un monto parecido y ofrece desactivarlo |
| **Cuotas que no se registran** (MVP manual) | La base del presupuesto ya las resta aunque no estén registradas; aparecen en pendientes hasta registrarlas |
| **Convertir el pago del 1/09 cambia los presupuestos actuales** | Decidido: no se convierte (B.6, §1.5) |
| **Cambio en el cálculo de saldos** (`TRANSFER`, `FINANCED_PURCHASE`) | Test de que los saldos no cambian con datos sin esos tipos; ningún despliegue crea movimientos por sí solo |
| **Enums de Postgres** | Solo valores decididos; `DEBIT_CARD` queda en el enum, rechazado en la API |
| **App móvil** (en pausa) | No conoce los tipos nuevos ni los 409; aceptado y anotado en su repo |

---

## I. Preguntas de producto (solo nuevas o que cambian)

Se cerraron: la #1 de la v1 (la TC VISA era el cupo disponible), la #2 (los pagos se registraron como `EXPENSE`) y la #8 (las metas son apartados). Las demás de la v1 siguen con su recomendación (deudas que consumen presupuesto, crear una deuda no mueve dinero, cupo no es activo, `TRANSFER` genérico, `DEBT_PAYMENT` sueltos permitidos, sin sobrepago, no borrar una deuda con pagos).

| # | Pregunta | Recomendación por defecto |
| --- | --- | --- |
| 1 | ¿Anclo la TC VISA con el **pago total 4.539.024** (y no 4.539.023,98) al 31/10? | **Sí**: pagarlo deja la tarjeta en 0 |
| 2 | ~~¿Las **compras con la Visa de agosto** están en la app?~~ **Cerrada:** la app no tiene nada antes del 28/08; el pago de 1.065.695 del 1/09 es probablemente el único registro de esas compras y **se deja como historia** (§1.5, B.6) | — |
| 3 | ¿Registro los **intereses (46.198,32) y la cuota de manejo (30.900) de octubre** como gastos del 31/10? | **Sí**: no cambian el saldo de la tarjeta y el gasto queda completo |
| 4 | **Cuotas**: ¿gasto cuota a cuota o completo al comprar? (cambia la #6 de la v1) | **Cuota a cuota** para 2 o más cuotas (D.3) |
| 5 | ¿Categoría de las **cuotas** reconocidas: `DEBT` o la de la compra? | **`DEBT`**, con la categoría original guardada en el plan |
| 6 | ¿En qué fecha cuenta la cuota: **corte** o **fecha de pago**? | **Fecha de pago** (≈17): es cuando sale la plata |
| 7 | ¿Las cuotas se registran **a mano** desde pendientes o **solas** al vencer? | **A mano** en el MVP ("Registrar todas"); automáticas en fase 2. El presupuesto las resta igual |
| 8 | ¿Las cuotas de la **ampliación de plazo** cuentan como gasto? | **No**, como dijiste. Consecuencia: ese capital sale de Ahorros (con el `TRANSFER`) sin aparecer nunca en el ledger. Si prefieres verlo, es `recognizeInstallments = true` en ese plan |
| 9 | ¿Qué **tasa** tiene la ampliación de plazo y cuándo empezó? | Necesito el dato del extracto; si no, la tarjeta por defecto (solo afecta la estimación) |
| 10 | ¿Creo la **TC Davivienda** como producto, con el celular como plan `LEGACY`, y desactivo el gasto fijo "Deuda celular"? | **Sí**, en el paso 5. Necesito su cupo, su deuda al último corte, sus días de corte y pago, y el plan del celular (monto, cuotas, en cuál va) |
| 11 | ¿Entidad como **tabla** o como texto en la cuenta? | **Tabla** mínima (E.1) |
| 12 | ¿`DEBIT_CARD` deja de ser un tipo y pasa a "cuenta con tarjeta débito"? | **Sí**; Ahorros Bancolombia pasa a `SAVINGS_ACCOUNT` + `hasDebitCard` |
| 13 | ¿Cuota de manejo automática ya o en fase 2? | **Fase 2**; en el MVP, un gasto fijo creado a mano y registrado con la tarjeta |
| 14 | ¿Se muestra el **sobrecupo** (deuda por encima del cupo)? | **Sí**: "Disponible 0 · Sobrecupo 239.024" |
| 15 | ¿**Deudas propias** (A) pasan a fase 2? | **Sí**, salvo que tengas deudas que no sean de tarjeta |
| 16 | ¿Pones al día también el saldo de **Ahorros Bancolombia** con el banco en el paso 4? | **Sí**, con el mismo mecanismo de ancla (B.5) |
| 17 | ¿Registras lo que falta de octubre (compras y el abono de 838.675)? | Opcional. Las compras como gastos con su fecha; el abono como `TRANSFER` cuando exista el paso 2, **nunca como gasto** |
