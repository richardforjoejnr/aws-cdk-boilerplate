import { S3Event } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const sfnClient = new SFNClient({});
const ddbClient = new DynamoDBClient({});
const dynamoClient = DynamoDBDocumentClient.from(ddbClient);

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;
const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;

export const handler = async (event: S3Event): Promise<void> => {
  console.log('S3 event received:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const uploadId = key.split('/')[0]; // Extract uploadId from key format: uploadId/filename.csv
    const fileName = key.split('/').pop() || '';

    try {
      console.log(`Starting processing for: ${key} from bucket: ${bucket}`);

      // Query to get the upload record with timestamp
      const uploadQuery = await dynamoClient.send(
        new QueryCommand({
          TableName: UPLOADS_TABLE,
          KeyConditionExpression: 'uploadId = :uploadId',
          ExpressionAttributeValues: {
            ':uploadId': uploadId,
          },
          Limit: 1,
        })
      );

      if (!uploadQuery.Items || uploadQuery.Items.length === 0) {
        console.error(`Upload record not found for uploadId: ${uploadId}`);
        continue;
      }

      const timestamp = uploadQuery.Items[0].timestamp as string;

      // Update status to processing
      await dynamoClient.send(
        new UpdateCommand({
          TableName: UPLOADS_TABLE,
          Key: {
            uploadId,
            timestamp,
          },
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'processing',
            ':updatedAt': new Date().toISOString(),
          },
        })
      );

      // Start Step Functions execution
      const executionName = `${uploadId}-${Date.now()}`;
      const input = {
        uploadId,
        timestamp,
        bucket,
        key,
        fileName,
        startRow: 2, // Start from row 2 (skip header)
        batchSize: 1000, // Process 1000 rows at a time
      };

      await sfnClient.send(
        new StartExecutionCommand({
          stateMachineArn: STATE_MACHINE_ARN,
          name: executionName,
          input: JSON.stringify(input),
        })
      );

      console.log(`Started Step Functions execution: ${executionName}`);
    } catch (error) {
      console.error(`Error starting processing for ${key}:`, error);

      // Try to update status to failed
      try {
        const uploadQuery = await dynamoClient.send(
          new QueryCommand({
            TableName: UPLOADS_TABLE,
            KeyConditionExpression: 'uploadId = :uploadId',
            ExpressionAttributeValues: {
              ':uploadId': uploadId,
            },
            Limit: 1,
          })
        );

        if (uploadQuery.Items && uploadQuery.Items.length > 0) {
          const timestamp = uploadQuery.Items[0].timestamp as string;
          await dynamoClient.send(
            new UpdateCommand({
              TableName: UPLOADS_TABLE,
              Key: {
                uploadId,
                timestamp,
              },
              UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, errorMessage = :errorMessage',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':status': 'failed',
                ':updatedAt': new Date().toISOString(),
                ':errorMessage': error instanceof Error ? error.message : String(error),
              },
            })
          );
        }
      } catch (updateError) {
        console.error('Error updating upload status:', updateError);
      }
    }
  }
};
