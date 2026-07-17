/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type GetCostAndUsageCommandOutput,
} from '@aws-sdk/client-cost-explorer';

const costExplorer = new CostExplorerClient({ region: 'us-east-1' }); // Cost Explorer is only available in us-east-1

interface CostData {
  currentMonth: {
    total: number;
    breakdown: Array<{ service: string; cost: number }>;
  };
  lastMonth: {
    total: number;
  };
  last7Days: {
    total: number;
    daily: Array<{ date: string; cost: number }>;
  };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstDayOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Format dates as YYYY-MM-DD
    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    // Get current month costs by service
    const currentMonthResponse: GetCostAndUsageCommandOutput = await costExplorer.send(
      new GetCostAndUsageCommand({
        TimePeriod: {
          Start: formatDate(firstDayOfMonth),
          End: formatDate(today),
        },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [
          {
            Type: 'DIMENSION',
            Key: 'SERVICE',
          },
        ],
      })
    );

    // Get last month total
    const lastMonthResponse: GetCostAndUsageCommandOutput = await costExplorer.send(
      new GetCostAndUsageCommand({
        TimePeriod: {
          Start: formatDate(firstDayOfLastMonth),
          End: formatDate(firstDayOfMonth),
        },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
      })
    );

    // Get last 7 days daily costs
    const last7DaysResponse: GetCostAndUsageCommandOutput = await costExplorer.send(
      new GetCostAndUsageCommand({
        TimePeriod: {
          Start: formatDate(sevenDaysAgo),
          End: formatDate(today),
        },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
      })
    );

    // Parse current month costs
    const currentMonthData = currentMonthResponse.ResultsByTime?.[0];
    const currentMonthTotal = parseFloat(currentMonthData?.Total?.UnblendedCost?.Amount || '0');
    const currentMonthBreakdown =
      currentMonthData?.Groups?.map((group) => ({
        service: group.Keys?.[0] || 'Unknown',
        cost: parseFloat(group.Metrics?.UnblendedCost?.Amount || '0'),
      }))
        .filter((item) => item.cost > 0.01) // Filter out very small costs
        .sort((a, b) => b.cost - a.cost) // Sort by cost descending
        .slice(0, 10) || []; // Top 10 services

    // Parse last month total
    const lastMonthTotal = parseFloat(
      lastMonthResponse.ResultsByTime?.[0]?.Total?.UnblendedCost?.Amount || '0'
    );

    // Parse last 7 days
    const last7DaysDaily =
      last7DaysResponse.ResultsByTime?.map((result) => ({
        date: result.TimePeriod?.Start || '',
        cost: parseFloat(result.Total?.UnblendedCost?.Amount || '0'),
      })) || [];

    const last7DaysTotal = last7DaysDaily.reduce((sum, day) => sum + day.cost, 0);

    const costData: CostData = {
      currentMonth: {
        total: currentMonthTotal,
        breakdown: currentMonthBreakdown,
      },
      lastMonth: {
        total: lastMonthTotal,
      },
      last7Days: {
        total: last7DaysTotal,
        daily: last7DaysDaily,
      },
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(costData),
    };
  } catch (error) {
    console.error('Error fetching costs:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Failed to fetch cost data',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
