import {
  AccountType,
  Category,
  Prisma,
  TransactionType,
  type Account,
} from '@prisma/client';
import {
  toTransactionResponse,
  type TransactionWithAccount,
} from './transaction-response.interface';

const DATE = new Date('2026-11-17T17:00:00Z');

function account(id: string, name: string, type: AccountType): Account {
  return {
    id,
    userId: 'user_1',
    name,
    type,
    initialBalance: new Prisma.Decimal(0),
    initialBalanceDate: null,
    institutionId: null,
    hasDebitCard: false,
    cardLast4: null,
    creditLimit: null,
    statementDay: null,
    paymentDueDay: null,
    defaultMonthlyRate: null,
    createdAt: DATE,
    updatedAt: DATE,
  };
}

function transaction(
  overrides: Partial<TransactionWithAccount>,
): TransactionWithAccount {
  return {
    id: 'tx_1',
    userId: 'user_1',
    accountId: null,
    toAccountId: null,
    recurringExpenseId: null,
    loanId: null,
    loanRepaymentId: null,
    amount: new Prisma.Decimal(838_675),
    type: TransactionType.EXPENSE,
    category: Category.OTHER,
    description: null,
    tags: [],
    rawMessage: '',
    transactionDate: DATE,
    monthYear: '2026-11',
    budgetPeriod: null,
    periodId: 'period_1',
    createdAt: DATE,
    updatedAt: DATE,
    account: null,
    toAccount: null,
    ...overrides,
  };
}

describe('toTransactionResponse', () => {
  it('includes the destination account of a transfer as a summary', () => {
    const savings = account(
      'acc_savings',
      'Ahorros',
      AccountType.SAVINGS_ACCOUNT,
    );
    const card = account('acc_visa', 'TC VISA', AccountType.CREDIT_CARD);

    const response = toTransactionResponse(
      transaction({
        type: TransactionType.TRANSFER,
        accountId: savings.id,
        account: savings,
        toAccountId: card.id,
        toAccount: card,
      }),
    );

    expect(response).toMatchObject({
      type: 'TRANSFER',
      accountId: 'acc_savings',
      account: { id: 'acc_savings', name: 'Ahorros', type: 'SAVINGS_ACCOUNT' },
      toAccountId: 'acc_visa',
      toAccount: {
        id: 'acc_visa',
        name: 'TC VISA',
        type: 'CREDIT_CARD',
        createdAt: DATE.toISOString(),
        updatedAt: DATE.toISOString(),
      },
    });
    expect(response.toAccount).not.toHaveProperty('currentBalance');
  });

  it('returns null destination fields for any other type', () => {
    const response = toTransactionResponse(transaction({}));

    expect(response.toAccountId).toBeNull();
    expect(response.toAccount).toBeNull();
  });
});
