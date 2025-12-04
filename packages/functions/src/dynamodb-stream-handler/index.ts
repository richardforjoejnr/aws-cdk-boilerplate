import { DynamoDBStreamHandler, DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';

/**
 * DynamoDB Stream Handler
 * Processes records from DynamoDB streams
 */
export const handler: DynamoDBStreamHandler = async (event) => {
  console.log('DynamoDB Stream event received:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    await processRecord(record);
  }

  return {
    batchItemFailures: [],
  };
};

async function processRecord(record: DynamoDBRecord): Promise<void> {
  console.log('Processing record:', record.eventID);
  console.log('Event Name:', record.eventName);

  if (!record.dynamodb) {
    console.warn('No DynamoDB data in record');
    return;
  }

  try {
    switch (record.eventName) {
      case 'INSERT':
        if (record.dynamodb.NewImage) {
          const newItem = unmarshall(
            record.dynamodb.NewImage as Record<string, AttributeValue>
          );
          console.log('New item created:', JSON.stringify(newItem, null, 2));
          // Add your custom logic here
        }
        break;

      case 'MODIFY':
        if (record.dynamodb.NewImage && record.dynamodb.OldImage) {
          const newItem = unmarshall(
            record.dynamodb.NewImage as Record<string, AttributeValue>
          );
          const oldItem = unmarshall(
            record.dynamodb.OldImage as Record<string, AttributeValue>
          );
          console.log('Item modified');
          console.log('Old:', JSON.stringify(oldItem, null, 2));
          console.log('New:', JSON.stringify(newItem, null, 2));
          // Add your custom logic here
        }
        break;

      case 'REMOVE':
        if (record.dynamodb.OldImage) {
          const oldItem = unmarshall(
            record.dynamodb.OldImage as Record<string, AttributeValue>
          );
          console.log('Item removed:', JSON.stringify(oldItem, null, 2));
          // Add your custom logic here
        }
        break;

      default:
        console.warn('Unknown event name:', record.eventName);
    }
  } catch (error) {
    console.error('Error processing record:', error);
    throw error;
  }
}
