import { env } from './env';

describe('EXECUTION_MAX_ATTEMPTS', () => {
  const original = process.env.EXECUTION_MAX_ATTEMPTS;
  afterEach(() => {
    if (original === undefined) delete process.env.EXECUTION_MAX_ATTEMPTS;
    else process.env.EXECUTION_MAX_ATTEMPTS = original;
  });

  it('usa 5 quando não configurado', () => {
    delete process.env.EXECUTION_MAX_ATTEMPTS;
    expect(env.executionMaxAttempts).toBe(5);
  });

  it('aceita inteiro positivo', () => {
    process.env.EXECUTION_MAX_ATTEMPTS = '3';
    expect(env.executionMaxAttempts).toBe(3);
  });

  it.each(['', '0', '-1', '1.5', '5abc', 'NaN', 'Infinity', '9007199254740992'])(
    'rejeita configuração inválida %s', (value) => {
      process.env.EXECUTION_MAX_ATTEMPTS = value;
      expect(() => env.executionMaxAttempts).toThrow('EXECUTION_MAX_ATTEMPTS must be a positive integer');
    },
  );
});
