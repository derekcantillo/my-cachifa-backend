import type { Category } from '@prisma/client';

export interface IBiggestExpense {
  category: Category;
  amount: number;
}

export interface ISavingsProgress {
  actual: number;
  planned: number;
  /** `actual / planned * 100`, a un decimal. 0 si `planned` es 0. */
  percentage: number;
}

export interface IMostFrequentCategory {
  category: Category;
  count: number;
}

export interface IReportSummary {
  biggestExpense: IBiggestExpense | null;
  savingsProgress: ISavingsProgress;
  mostFrequentCategory: IMostFrequentCategory | null;
}

export interface IDistributionItem {
  category: Category;
  amount: number;
  /** Porcentaje sobre el total gastado (EXPENSE) del mes. */
  percentage: number;
}

export interface ISavingsProjectionPoint {
  date: string;
  cumulativeAmount: number;
}

export interface ISavingsProjectionMarker {
  date: string;
  label: string;
}

export interface ISavingsProjection {
  points: ISavingsProjectionPoint[];
  markers: ISavingsProjectionMarker[];
}
