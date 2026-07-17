import { DescribeEndpointCommand, IoTClient } from '@aws-sdk/client-iot';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';

export const iot = new IoTClient({});

let dataClient: IoTDataPlaneClient | null = null;
let cachedEndpoint: string | null = null;

export async function getIotEndpoint(): Promise<string> {
  if (cachedEndpoint) return cachedEndpoint;
  const res = await iot.send(new DescribeEndpointCommand({ endpointType: 'iot:Data-ATS' }));
  cachedEndpoint = res.endpointAddress as string;
  return cachedEndpoint;
}

/** QoS 1 publish to a per-device topic (never a shared topic — vocovo-reuse-review §1). */
export async function publishToDevice(topic: string, payload: unknown): Promise<void> {
  if (!dataClient) {
    dataClient = new IoTDataPlaneClient({ endpoint: `https://${await getIotEndpoint()}` });
  }
  await dataClient.send(
    new PublishCommand({ topic, qos: 1, payload: Buffer.from(JSON.stringify(payload)) })
  );
}
