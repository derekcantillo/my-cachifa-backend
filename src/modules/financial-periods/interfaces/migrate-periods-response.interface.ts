export interface IMigratedPeriodResponse {
  id: string;
  label: string;
  startDate: string;
  endDate: string | null;
  anchorTxId: string | null;
  transactionCount: number;
}

export interface IMigratePeriodsResponse {
  users: Array<{
    userId: string;
    transactions: number;
    /** Debe ser 0: toda transacción queda dentro de algún período. */
    unassigned: number;
    periods: IMigratedPeriodResponse[];
  }>;
}
