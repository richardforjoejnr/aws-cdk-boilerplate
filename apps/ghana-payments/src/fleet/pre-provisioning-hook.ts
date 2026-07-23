import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../shared/clients.js';
import type { DeviceItem } from '../devices/handlers.js';

/**
 * AWS IoT Fleet Provisioning pre-provisioning hook (payloadVersion 2020-04-01).
 *
 * Invoked synchronously while a device provisions with the shared claim cert.
 * It is the security gate that stops a leaked claim cert from minting unlimited
 * device identities: provisioning is allowed ONLY for a serial that was recorded
 * as MANUFACTURED (or is re-provisioning an already-known device), never an
 * arbitrary serial. On success the device row is advanced to PROVISIONED so it
 * shows up as unassigned inventory ready for an operator to pair to a store.
 */
interface PreProvisionEvent {
  claimCertificateId?: string;
  certificateId?: string;
  parameters?: Record<string, string>;
}
interface PreProvisionResult {
  allowProvisioning: boolean;
  parameterOverrides?: Record<string, string>;
}

const DEVICES_TABLE = (): string => process.env.DEVICES_TABLE ?? '';

// Serials in these states may (re)provision; anything else is refused.
const PROVISIONABLE = new Set(['MANUFACTURED', 'PROVISIONED', 'UNASSIGNED']);

export const handler = async (event: PreProvisionEvent): Promise<PreProvisionResult> => {
  const serial = event.parameters?.SerialNumber?.trim();
  const log = (allow: boolean, reason: string): void =>
    console.log(JSON.stringify({ msg: 'preprovision', serial, allow, reason }));

  if (!serial) {
    log(false, 'no-serial');
    return { allowProvisioning: false };
  }

  // Serial must exist in the manufactured allow-list (registered out of band by
  // the factory/warehouse tool). GSI2 is the serial_number index.
  const found = await ddb.send(
    new QueryCommand({
      TableName: DEVICES_TABLE(),
      IndexName: 'GSI2',
      KeyConditionExpression: 'serial_number = :s',
      ExpressionAttributeValues: { ':s': serial },
    })
  );
  const device = ((found.Items ?? []) as DeviceItem[]).find((d) => PROVISIONABLE.has(d.status));
  if (!device) {
    log(false, 'unknown-or-non-provisionable-serial');
    return { allowProvisioning: false };
  }

  // Strongly-consistent re-check + advance to PROVISIONED. Keep merchant_id if the
  // device was already assigned (a factory-reset unit re-provisioning keeps its store).
  const fresh = await ddb.send(
    new GetCommand({ TableName: DEVICES_TABLE(), Key: { device_id: device.device_id }, ConsistentRead: true })
  );
  const current = fresh.Item as DeviceItem | undefined;
  if (!current || !PROVISIONABLE.has(current.status)) {
    log(false, 'race-non-provisionable');
    return { allowProvisioning: false };
  }

  // A device that was already assigned to a store (factory-reset re-provision)
  // comes back ACTIVE; a fresh unit becomes PROVISIONED inventory.
  const newStatus = current.merchant_id ? 'ACTIVE' : 'PROVISIONED';
  await ddb.send(
    new UpdateCommand({
      TableName: DEVICES_TABLE(),
      Key: { device_id: device.device_id },
      UpdateExpression:
        'SET #status = :status, thing_name = :tn, provisioned_at = :now, device_type = :real',
      ConditionExpression: 'attribute_exists(device_id)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': newStatus,
        ':tn': `soundbox-${serial}`,
        ':now': new Date().toISOString(),
        ':real': 'REAL',
      },
    })
  );

  log(true, 'ok');
  return { allowProvisioning: true, parameterOverrides: { SerialNumber: serial } };
};
