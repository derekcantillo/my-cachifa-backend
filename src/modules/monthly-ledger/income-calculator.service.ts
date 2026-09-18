import { Injectable } from '@nestjs/common';
import { Category, Prisma, TransactionType } from '@prisma/client';

@Injectable()
export class IncomeCalculatorService {
  /**
   * Ingreso efectivo de un mes: SALARY cuenta por `budgetPeriod` (el mes que
   * el pago cubre, no el mes en que se recibió, por el desfase de nómina);
   * cualquier otro ingreso cuenta por `monthYear` (el mes en que se
   * registró). Recibe el cliente de Prisma para poder correr dentro de la
   * misma transacción que la mutación que dispara el recálculo.
   */
  async getEffectiveIncome(
    client: Prisma.TransactionClient,
    userId: string,
    month: string,
  ): Promise<Prisma.Decimal> {
    const [salary, other] = await Promise.all([
      client.transaction.aggregate({
        where: {
          userId,
          type: TransactionType.INCOME,
          category: Category.SALARY,
          budgetPeriod: month,
        },
        _sum: { amount: true },
      }),
      client.transaction.aggregate({
        where: {
          userId,
          type: TransactionType.INCOME,
          category: { not: Category.SALARY },
          monthYear: month,
        },
        _sum: { amount: true },
      }),
    ]);

    const salaryTotal = salary._sum.amount ?? new Prisma.Decimal(0);
    const otherTotal = other._sum.amount ?? new Prisma.Decimal(0);
    return salaryTotal.plus(otherTotal);
  }
}
