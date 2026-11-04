export interface INetWorthAssets {
  /** Suma de `currentBalance` de las cuentas que no son tarjeta de crédito. */
  accountsBalance: number;
  /** Lo que falta por cobrar de los préstamos no pagados (`amount - amountRepaid`). */
  receivables: number;
  /**
   * @deprecated Ya no es un activo ni suma en el patrimonio: usar `info.goalsSavings`.
   * Se mantiene para la app móvil, que lo lee de aquí.
   */
  goalsSavings: number;
  /**
   * @deprecated Ya no es un activo ni suma en el patrimonio: usar `info.creditCardsAvailable`.
   * Se mantiene para la app móvil, que lo lee de aquí.
   */
  creditCardsAvailable: number;
}

export interface INetWorthLiabilities {
  /** Placeholder: deudas propias son un frente posterior. */
  debts: number;
  /** Placeholder: tarjetas de crédito son un frente posterior. */
  creditCardsDebt: number;
}

/** Tarjeta de crédito sin cupo configurado: su saldo no entra en los totales. */
export interface INetWorthUnconfiguredCard {
  id: string;
  name: string;
  currentBalance: number;
}

/** Datos informativos: no suman ni restan en `netWorth`. */
export interface INetWorthInfo {
  /** Suma de `Goal.currentAmount`: apartados dentro del saldo de las cuentas. */
  goalsSavings: number;
  /** Cupo disponible de las tarjetas. Placeholder: tarjetas son un frente posterior. */
  creditCardsAvailable: number;
  unconfiguredCards: INetWorthUnconfiguredCard[];
}

export interface INetWorthTotals {
  /** `accountsBalance + receivables`. */
  assets: number;
  /** `debts + creditCardsDebt`. */
  liabilities: number;
}

export interface INetWorthResponse {
  assets: INetWorthAssets;
  liabilities: INetWorthLiabilities;
  info: INetWorthInfo;
  totals: INetWorthTotals;
  /** `totals.assets - totals.liabilities`. */
  netWorth: number;
}
