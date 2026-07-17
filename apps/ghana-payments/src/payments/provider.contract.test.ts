/**
 * Provider contract tests (D1 / architecture §4.1).
 *
 * One shared fixture describes the MTN MoMo Collections callback shape (concept §17).
 * Today it is asserted against MockMomoProvider's SQS-enqueued payloads AND against the
 * webhook normalizer end-to-end. A future MtnSandboxProvider must pass this exact file
 * unchanged — that is the point of the seam.
 */
import { mockClient } from 'aws-sdk-client-mock';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ddb } from '../shared/clients.js';
import { _resetConfigCache } from '../shared/config.js';
import { MockMomoProvider, type MockCallbackBody } from './mock-provider.js';
import { handler as webhookHandler } from './webhook.js';

const sqsMock = mockClient(SQSClient);
const ssmMock = mockClient(SSMClient);
const s3Mock = mockClient(S3Client);
const busMock = mockClient(EventBridgeClient);
const ddbMock = mockClient(ddb as unknown as DynamoDBDocumentClient);

process.env.MOCK_CALLBACK_QUEUE_URL = 'https://sqs.test/queue';
process.env.PAYMENTS_TABLE = 'test-payments';
process.env.WEBHOOK_INBOX_BUCKET = 'test-inbox';
process.env.EVENT_BUS_NAME = 'test-bus';
process.env.STAGE = 'dev';

// ---------------------------------------------------------------------------
// THE CONTRACT — MTN MoMo Collections callback (concept §17)
// ---------------------------------------------------------------------------
interface CallbackExpectation {
  paymentId: string;
  amountPesewas: number;
  payerPhone: string;
}

function expectMomoCollectionsCallback(raw: string, expected: CallbackExpectation): MockCallbackBody {
  const body = JSON.parse(raw) as MockCallbackBody;

  // externalId carries OUR payment id (MTN X-Reference-Id model)
  expect(body.externalId).toBe(expected.paymentId);

  // provider transaction id: non-empty string, unique per collection attempt
  expect(typeof body.financialTransactionId).toBe('string');
  expect(body.financialTransactionId.length).toBeGreaterThan(0);

  // amount: DECIMAL STRING with two decimals (MTN sends major units as a string),
  // round-tripping exactly to our integer pesewas
  expect(typeof body.amount).toBe('string');
  expect(body.amount).toMatch(/^\d+\.\d{2}$/);
  expect(Math.round(parseFloat(body.amount) * 100)).toBe(expected.amountPesewas);

  expect(body.currency).toBe('GHS');
  expect(['SUCCESSFUL', 'FAILED']).toContain(body.status);
  if (body.status === 'FAILED') {
    expect(typeof body.reason).toBe('string');
    expect((body.reason as string).length).toBeGreaterThan(0);
  }

  expect(body.payer.partyIdType).toBe('MSISDN');
  expect(body.payer.partyId).toBe(expected.payerPhone);

  return body;
}

const req = (amountPesewas: number) => ({
  paymentId: 'pay_ct1',
  merchantId: 'mer_1',
  payerPhone: '0244000000',
  amountPesewas,
});

const enqueued = (): string[] =>
  sqsMock.commandCalls(SendMessageCommand).map((c) => c.args[0].input.MessageBody as string);

beforeEach(() => {
  sqsMock.reset();
  ssmMock.reset();
  s3Mock.reset();
  busMock.reset();
  ddbMock.reset();
  _resetConfigCache();
  ssmMock.on(GetParametersByPathCommand).resolves({
    Parameters: [
      { Name: '/dev/ghana-payments/mock/fail-amount-pesewas', Value: '1300' },
      { Name: '/dev/ghana-payments/mock/timeout-amount-pesewas', Value: '999' },
      { Name: '/dev/ghana-payments/mock/duplicate-amount-pesewas', Value: '222' },
      { Name: '/dev/ghana-payments/mock/callback-delay-seconds', Value: '3' },
    ],
  });
  sqsMock.on(SendMessageCommand).resolves({});
  s3Mock.on(PutObjectCommand).resolves({});
  busMock.on(PutEventsCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
});

describe('MockMomoProvider satisfies the MoMo Collections callback contract', () => {
  it('SUCCESS callback (odd pesewas amount round-trips exactly)', async () => {
    await new MockMomoProvider().initiatePayment(req(2005));
    const [raw] = enqueued();
    const body = expectMomoCollectionsCallback(raw, {
      paymentId: 'pay_ct1',
      amountPesewas: 2005,
      payerPhone: '0244000000',
    });
    expect(body.status).toBe('SUCCESSFUL');
  });

  it('FAILED callback carries a reason', async () => {
    await new MockMomoProvider().initiatePayment(req(1300));
    const body = expectMomoCollectionsCallback(enqueued()[0], {
      paymentId: 'pay_ct1',
      amountPesewas: 1300,
      payerPhone: '0244000000',
    });
    expect(body.status).toBe('FAILED');
  });

  it('DUPLICATE delivers the identical conformant payload twice (same financialTransactionId)', async () => {
    await new MockMomoProvider().initiatePayment(req(222));
    const payloads = enqueued();
    expect(payloads).toHaveLength(2);
    const bodies = payloads.map((p) =>
      expectMomoCollectionsCallback(p, {
        paymentId: 'pay_ct1',
        amountPesewas: 222,
        payerPhone: '0244000000',
      })
    );
    expect(payloads[0]).toBe(payloads[1]); // byte-identical — ADR-4a's IDEM item catches it
    expect(bodies[0].financialTransactionId).toBe(bodies[1].financialTransactionId);
  });
});

describe('the webhook normalizer accepts the same contract end-to-end', () => {
  const webhookEvent = (rawBody: string): APIGatewayProxyEvent =>
    ({ pathParameters: { provider: 'mock' }, body: rawBody }) as unknown as APIGatewayProxyEvent;

  it('SUCCESS payload from the provider flows to a SUCCESS ledger transition + payment.confirmed', async () => {
    await new MockMomoProvider().initiatePayment(req(2005));
    const raw = enqueued()[0];
    const contract = expectMomoCollectionsCallback(raw, {
      paymentId: 'pay_ct1',
      amountPesewas: 2005,
      payerPhone: '0244000000',
    });

    ddbMock.on(TransactWriteCommand).resolves({});
    ddbMock.on(GetCommand).resolves({
      Item: { payment_id: 'pay_ct1', sk: 'META', status: 'SUCCESS', merchant_id: 'mer_1', amount_pesewas: 2005 },
    });

    const res = await webhookHandler(webhookEvent(raw));
    expect(res.statusCode).toBe(200);

    // Ledger transition keyed by the contract's fields
    const transact = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input;
    const idemPut = transact.TransactItems?.[0]?.Put?.Item;
    expect(idemPut?.payment_id).toBe(contract.externalId);
    expect(idemPut?.sk).toBe(`IDEM#${contract.financialTransactionId}`);
    const metaUpdate = transact.TransactItems?.[1]?.Update;
    expect(metaUpdate?.ExpressionAttributeValues?.[':to']).toBe('SUCCESS');

    // Published internal event is normalized correctly
    const entry = busMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries?.[0];
    expect(entry?.DetailType).toBe('payment.confirmed');
    const detail = JSON.parse(entry?.Detail ?? '{}') as {
      payment_id: string;
      provider: string;
      provider_transaction_id: string;
      amount: number;
      currency: string;
    };
    expect(detail.payment_id).toBe(contract.externalId);
    expect(detail.provider).toBe('MTN_MOMO');
    expect(detail.provider_transaction_id).toBe(contract.financialTransactionId);
    expect(detail.amount).toBe(2005); // integer pesewas, never the decimal string
    expect(detail.currency).toBe('GHS');
  });

  it('FAILED payload flows to a FAILED transition with the provider reason + payment.failed', async () => {
    await new MockMomoProvider().initiatePayment(req(1300));
    const raw = enqueued()[0];
    const contract = expectMomoCollectionsCallback(raw, {
      paymentId: 'pay_ct1',
      amountPesewas: 1300,
      payerPhone: '0244000000',
    });

    ddbMock.on(TransactWriteCommand).resolves({});
    ddbMock.on(GetCommand).resolves({
      Item: { payment_id: 'pay_ct1', sk: 'META', status: 'FAILED', merchant_id: 'mer_1', amount_pesewas: 1300 },
    });

    const res = await webhookHandler(webhookEvent(raw));
    expect(res.statusCode).toBe(200);

    const metaUpdate = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input
      .TransactItems?.[1]?.Update;
    expect(metaUpdate?.ExpressionAttributeValues?.[':to']).toBe('FAILED');
    expect(metaUpdate?.ExpressionAttributeValues?.[':reason']).toBe(contract.reason);

    const entry = busMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries?.[0];
    expect(entry?.DetailType).toBe('payment.failed');
  });
});
