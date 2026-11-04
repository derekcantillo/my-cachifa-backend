import { CLASSIFIER_SYSTEM_PROMPT } from './classifier.prompt';

describe('CLASSIFIER_SYSTEM_PROMPT', () => {
  it('only offers the message types the WhatsApp flow knows (no TRANSFER)', () => {
    const offered = [
      ...CLASSIFIER_SYSTEM_PROMPT.matchAll(/type: '([a-z_]+)'/g),
    ].map((match) => match[1]);

    expect(offered).toEqual([
      'expense',
      'income',
      'saving',
      'debt_payment',
      'query',
      'unknown',
    ]);
    expect(CLASSIFIER_SYSTEM_PROMPT).not.toMatch(/transfer/i);
  });
});
