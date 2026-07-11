import { mockClient } from 'aws-sdk-client-mock';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { MockMomoProvider } from './mock-provider.js';
import { _resetConfigCache } from '../shared/config.js';

const sqsMock = mockClient(SQSClient);
const ssmMock = mockClient(SSMClient);

process.env.MOCK_CALLBACK_QUEUE_URL = 'https://sqs.test/queue';
process.env.STAGE = 'dev';

const param = (suffix: string, value: string) => ({
  Name: `/dev/ghana-payments/${suffix}`,
  Value: value,
});

beforeEach(() => {
  sqsMock.reset();
  ssmMock.reset();
  _resetConfigCache();
  ssmMock.on(GetParametersByPathCommand).resolves({
    Parameters: [
      param('mock/fail-amount-pesewas', '1300'),
      param('mock/timeout-amount-pesewas', '999'),
      param('mock/duplicate-amount-pesewas', '222'),
      param('mock/callback-delay-seconds', '3'),
    ],
  });
  sqsMock.on(SendMessageCommand).resolves({});
});

const req = (amountPesewas: number) => ({
  paymentId: 'pay_1',
  merchantId: 'mer_1',
  payerPhone: '0244000000',
  amountPesewas,
});

describe('MockMomoProvider amount rules (ADR-7)', () => {
  it('any normal amount -> one SUCCESSFUL callback', async () => {
    await new MockMomoProvider().initiatePayment(req(2000));
    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].args[0].input.MessageBody as string);
    expect(body.status).toBe('SUCCESSFUL');
    expect(body.externalId).toBe('pay_1');
    expect(body.amount).toBe('20.00');
    expect(calls[0].args[0].input.DelaySeconds).toBe(3);
  });

  it('fail amount (1300) -> one FAILED callback with reason', async () => {
    await new MockMomoProvider().initiatePayment(req(1300));
    const body = JSON.parse(
      sqsMock.commandCalls(SendMessageCommand)[0].args[0].input.MessageBody as string
    );
    expect(body.status).toBe('FAILED');
    expect(body.reason).toBeDefined();
  });

  it('timeout amount (999) -> NO callback (sweeper territory, ADR-5)', async () => {
    await new MockMomoProvider().initiatePayment(req(999));
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it('duplicate amount (222) -> two callbacks with the SAME financialTransactionId', async () => {
    await new MockMomoProvider().initiatePayment(req(222));
    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls).toHaveLength(2);
    const [a, b] = calls.map((c) => JSON.parse(c.args[0].input.MessageBody as string));
    expect(a.financialTransactionId).toBe(b.financialTransactionId);
  });
});
