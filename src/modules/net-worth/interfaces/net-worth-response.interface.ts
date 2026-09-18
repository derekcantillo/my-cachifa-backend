export interface INetWorthAssets {
  /** Suma de `currentBalance` de todas las cuentas. */
  accountsBalance: number;
  /** Lo que falta por cobrar de los préstamos no pagados (`amount - amountRepaid`). */
  receivables: number;
  /** Suma de `Goal.currentAmount`. */
  goalsSavings: number;
  /** Placeholder: tarjetas de crédito son un frente posterior. */
  creditCardsAvailable: number;
}

export interface INetWorthLiabilities {
  /** Placeholder: deudas propias son un frente posterior. */
  debts: number;
  /** Placeholder: tarjetas de crédito son un frente posterior. */
  creditCardsDebt: number;
}

export interface INetWorthResponse {
  assets: INetWorthAssets;
  liabilities: INetWorthLiabilities;
  /** Total de activos menos total de pasivos. */
  netWorth: number;
}
