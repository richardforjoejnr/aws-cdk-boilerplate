import { Handler, Context } from 'aws-lambda';

export interface HelloWorldEvent {
  name?: string;
  message?: string;
}

export interface HelloWorldResponse {
  statusCode: number;
  body: string;
  message: string;
}

/**
 * Hello World Lambda function
 * Simple function that returns a greeting message
 */
export const handler: Handler<HelloWorldEvent, HelloWorldResponse> = async (
  event: HelloWorldEvent,
  context: Context
): Promise<HelloWorldResponse> => {
  console.log('Event received:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));

  const name = event.name || 'World';
  const customMessage = event.message || '';

  const greeting = customMessage
    ? `Hello ${name}! ${customMessage}`
    : `Hello ${name}!`;

  const response: HelloWorldResponse = {
    statusCode: 200,
    body: JSON.stringify({
      greeting,
      timestamp: new Date().toISOString(),
      requestId: context.awsRequestId,
    }),
    message: greeting,
  };

  console.log('Response:', JSON.stringify(response, null, 2));

  return response;
};
