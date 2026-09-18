import { Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';

@Injectable()
export class IncomeCalculatorService {
  /**
   * Ingreso efectivo de un período: todo `INCOME` asignado a él (salario
   * incluido — su fecha ya define su período). `LOAN_REPAYMENT` no entra:
   * es la devolución de un préstamo, no ingreso nuevo. Recibe el cliente de
   * Prisma para poder correr dentro de la misma transacción que la mutación
   * que dispara el recálculo.
   */
  async getEffectiveIncome(
    client: Prisma.TransactionClient,
    userId: string,
    periodId: string,
  ): Promise<Prisma.Decimal> {
    const income = await client.transaction.aggregate({
      where: { userId, periodId, type: TransactionType.INCOME },
      _sum: { amount: true },
    });

    return income._sum.amount ?? new Prisma.Decimal(0);
  }
}
