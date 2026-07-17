import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { parse } from 'csv-parse';
import { Readable } from 'stream';

const s3Client = new S3Client({});
const ddbClient = new DynamoDBClient({});
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
const dynamoClient = DynamoDBDocumentClient.from(ddbClient);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
const cloudwatchClient = new CloudWatchClient({});

const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;

// Helper function to publish cost optimization metrics
async function publishMetrics(progressUpdateCount: number, metricsCalculated: boolean): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await cloudwatchClient.send(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      new PutMetricDataCommand({
        Namespace: 'JiraDashboard/CostOptimization',
        MetricData: [
          {
            MetricName: 'DynamoDBWrites',
            Value: 0, // PHASE 3: No more writes to issues table!
            Unit: 'Count',
            Timestamp: new Date(),
          },
          {
            MetricName: 'ProgressUpdates',
            Value: progressUpdateCount,
            Unit: 'Count',
            Timestamp: new Date(),
          },
          {
            MetricName: 'MetricsCalculated',
            Value: metricsCalculated ? 1 : 0,
            Unit: 'Count',
            Timestamp: new Date(),
          },
        ],
      })
    );
  } catch (error) {
    console.warn('Failed to publish metrics:', error);
    // Don't fail the function if metrics fail
  }
}

interface JiraIssue {
  summary: string;
  issueKey: string;
  issueId: string;
  issueType: string;
  status: string;
  priority: string;
  assignee: string;
  created: string;
  updated: string;
  resolved?: string;
  projectKey: string;
  projectName: string;
  [key: string]: string | undefined;
}

interface CsvRecord {
  [key: string]: string;
}

interface TopIssue {
  issueKey: string;
  summary: string;
  status: string;
  priority: string;
  issueType: string;
  assignee: string;
  created: string;
  updated: string;
  resolved?: string;
  projectKey: string;
  projectName: string;
}

interface BatchMetrics {
  totalIssues: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byType: Record<string, number>;
  byAssignee: Record<string, number>;
  unassigned: number;

  // Top N lists for dashboard
  topOpenBugs: TopIssue[];
  topUnassignedIssues: TopIssue[];
  topRecentIssues: TopIssue[];

  // Time-based metrics
  thisMonth: {
    created: number;
    closed: number;
    bugsCreated: number;
    bugsClosed: number;
  };

  bugs: {
    total: number;
    open: number;
    byPriority: Record<string, number>;
  };

  // Work type specific metrics
  epics: { completed: number; inProgress: number; blocked: number };
  stories: { completed: number; inProgress: number; storyPointsDelivered: number };
  tasks: { completed: number; inProgress: number; overdue: number };
  spikes: { completed: number; inFlight: number; pending: number };
  risks: { new: number; active: number; mitigated: number };
  adrs: { approved: number; pendingReview: number; inProgress: number };
  escalatedDefects: { active: number };
  initiatives: { delivered: number; atRisk: number };

  // Calculated metrics (for averaging later)
  cycleTimeSums: {
    epicCycleTimes: number[];
    storyCycleTimes: number[];
    bugAges: number[];
    bugResolutionTimes: number[];
  };
}

interface ProcessBatchInput {
  uploadId: string;
  timestamp: string;
  bucket: string;
  key: string;
  fileName: string;
  startRow: number;
  batchSize: number;
  totalRows?: number;
  accumulatedMetrics?: BatchMetrics; // Carry forward from previous batches
}

interface ProcessBatchOutput {
  uploadId: string;
  timestamp: string;
  bucket: string;
  key: string;
  fileName: string;
  startRow: number;
  batchSize: number;
  totalRows: number;
  processedRows: number;
  hasMore: boolean;
  nextStartRow?: number;
  batchMetrics: BatchMetrics; // Return metrics for accumulation
}

// Initialize empty metrics
function initializeMetrics(): BatchMetrics {
  return {
    totalIssues: 0,
    byStatus: {},
    byPriority: {},
    byType: {},
    byAssignee: {},
    unassigned: 0,
    topOpenBugs: [],
    topUnassignedIssues: [],
    topRecentIssues: [],
    thisMonth: {
      created: 0,
      closed: 0,
      bugsCreated: 0,
      bugsClosed: 0,
    },
    bugs: {
      total: 0,
      open: 0,
      byPriority: {},
    },
    epics: { completed: 0, inProgress: 0, blocked: 0 },
    stories: { completed: 0, inProgress: 0, storyPointsDelivered: 0 },
    tasks: { completed: 0, inProgress: 0, overdue: 0 },
    spikes: { completed: 0, inFlight: 0, pending: 0 },
    risks: { new: 0, active: 0, mitigated: 0 },
    adrs: { approved: 0, pendingReview: 0, inProgress: 0 },
    escalatedDefects: { active: 0 },
    initiatives: { delivered: 0, atRisk: 0 },
    cycleTimeSums: {
      epicCycleTimes: [],
      storyCycleTimes: [],
      bugAges: [],
      bugResolutionTimes: [],
    },
  };
}

// Helper to check if status is "done"
const isDone = (status: string) =>
  ['done', 'closed', 'resolved', 'completed'].some((s) => status.toLowerCase().includes(s));
const isInProgress = (status: string) =>
  ['in progress', 'in development', 'active'].some((s) => status.toLowerCase().includes(s));
const isBlocked = (status: string) => status.toLowerCase().includes('blocked');

// Helper to calculate days between dates
const daysBetween = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.abs((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
};

// Process a single issue and update metrics
function processIssue(issue: JiraIssue, metrics: BatchMetrics, now: Date) {
  const issueType = issue.issueType?.toLowerCase() || '';
  const status = issue.status || '';
  const priority = issue.priority || '';
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  metrics.totalIssues++;

  // Count by status
  if (issue.status) {
    metrics.byStatus[issue.status] = (metrics.byStatus[issue.status] || 0) + 1;
  }

  // Count by priority
  if (issue.priority) {
    metrics.byPriority[issue.priority] = (metrics.byPriority[issue.priority] || 0) + 1;
  }

  // Count by type
  if (issue.issueType) {
    metrics.byType[issue.issueType] = (metrics.byType[issue.issueType] || 0) + 1;
  }

  // Count by assignee
  if (!issue.assignee || issue.assignee === 'Unassigned') {
    metrics.unassigned++;
  } else {
    metrics.byAssignee[issue.assignee] = (metrics.byAssignee[issue.assignee] || 0) + 1;
  }

  // Track top issues for dashboard lists
  const topIssue: TopIssue = {
    issueKey: issue.issueKey,
    summary: issue.summary,
    status: issue.status,
    priority: issue.priority,
    issueType: issue.issueType,
    assignee: issue.assignee,
    created: issue.created,
    updated: issue.updated,
    resolved: issue.resolved,
    projectKey: issue.projectKey,
    projectName: issue.projectName,
  };

  // Track open bugs
  const isBug = issueType.includes('bug') || issueType === 'escalated defect';
  if (isBug && !isDone(status)) {
    metrics.topOpenBugs.push(topIssue);
    // Keep only top 20 by priority (will trim to 10 later)
    metrics.topOpenBugs.sort((a, b) => {
      const priorityOrder: Record<string, number> = {
        'Highest': 0, 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'Lowest': 4
      };
      return (priorityOrder[a.priority] || 5) - (priorityOrder[b.priority] || 5);
    });
    if (metrics.topOpenBugs.length > 20) {
      metrics.topOpenBugs = metrics.topOpenBugs.slice(0, 20);
    }
  }

  // Track unassigned issues
  if (!issue.assignee || issue.assignee === 'Unassigned') {
    metrics.topUnassignedIssues.push(topIssue);
    if (metrics.topUnassignedIssues.length > 20) {
      metrics.topUnassignedIssues = metrics.topUnassignedIssues.slice(0, 20);
    }
  }

  // Track recent issues (by created date)
  metrics.topRecentIssues.push(topIssue);
  metrics.topRecentIssues.sort((a, b) =>
    new Date(b.created).getTime() - new Date(a.created).getTime()
  );
  if (metrics.topRecentIssues.length > 30) {
    metrics.topRecentIssues = metrics.topRecentIssues.slice(0, 30);
  }

  // Bug metrics
  if (isBug) {
    metrics.bugs.total++;
    if (!isDone(status)) {
      metrics.bugs.open++;
    }
    if (priority) {
      metrics.bugs.byPriority[priority] = (metrics.bugs.byPriority[priority] || 0) + 1;
    }

    // Bug age
    if (issue.created && !isDone(status)) {
      const age = daysBetween(issue.created, now.toISOString());
      metrics.cycleTimeSums.bugAges.push(age);
    }

    // Bug resolution time
    if (issue.created && issue.resolved) {
      metrics.cycleTimeSums.bugResolutionTimes.push(daysBetween(issue.created, issue.resolved));
    }
  }

  // Work type metrics
  if (issueType === 'epic') {
    if (isDone(status)) {
      metrics.epics.completed++;
      if (issue.created && issue.resolved) {
        metrics.cycleTimeSums.epicCycleTimes.push(daysBetween(issue.created, issue.resolved));
      }
    } else if (isInProgress(status)) {
      metrics.epics.inProgress++;
    }
    if (isBlocked(status)) {
      metrics.epics.blocked++;
    }
  }

  if (issueType === 'story') {
    if (isDone(status)) {
      metrics.stories.completed++;
      const storyPoints = parseFloat(issue['Story Points'] || '0');
      if (storyPoints > 0) {
        metrics.stories.storyPointsDelivered += storyPoints;
      }
      if (issue.created && issue.resolved) {
        metrics.cycleTimeSums.storyCycleTimes.push(daysBetween(issue.created, issue.resolved));
      }
    } else if (isInProgress(status)) {
      metrics.stories.inProgress++;
    }
  }

  if (issueType === 'task') {
    if (isDone(status)) {
      metrics.tasks.completed++;
    } else if (isInProgress(status)) {
      metrics.tasks.inProgress++;
    }
    if (issue['Due date']) {
      const dueDate = new Date(issue['Due date']);
      if (dueDate < now && !isDone(status)) {
        metrics.tasks.overdue++;
      }
    }
  }

  if (issueType === 'spike') {
    if (isDone(status)) {
      metrics.spikes.completed++;
    } else if (isInProgress(status)) {
      metrics.spikes.inFlight++;
    } else {
      metrics.spikes.pending++;
    }
  }

  if (issueType === 'risk') {
    if (isDone(status) || status.toLowerCase().includes('mitigated')) {
      metrics.risks.mitigated++;
    } else if (isInProgress(status) || status.toLowerCase().includes('active')) {
      metrics.risks.active++;
    } else {
      metrics.risks.new++;
    }
  }

  if (issueType === 'adr' || issueType.includes('decision')) {
    if (status.toLowerCase().includes('approved')) {
      metrics.adrs.approved++;
    } else if (status.toLowerCase().includes('review')) {
      metrics.adrs.pendingReview++;
    } else {
      metrics.adrs.inProgress++;
    }
  }

  if (issueType === 'escalated defect') {
    if (!isDone(status)) {
      metrics.escalatedDefects.active++;
    }
  }

  if (issueType === 'initiative') {
    if (isDone(status)) {
      metrics.initiatives.delivered++;
    }
    if (isBlocked(status) || status.toLowerCase().includes('risk')) {
      metrics.initiatives.atRisk++;
    }
  }

  // This month metrics
  if (issue.created) {
    const createdDate = new Date(issue.created);
    if (createdDate.getMonth() === currentMonth && createdDate.getFullYear() === currentYear) {
      metrics.thisMonth.created++;
      if (isBug) {
        metrics.thisMonth.bugsCreated++;
      }
    }
  }

  if (issue.resolved) {
    const resolvedDate = new Date(issue.resolved);
    if (resolvedDate.getMonth() === currentMonth && resolvedDate.getFullYear() === currentYear) {
      metrics.thisMonth.closed++;
      if (isBug) {
        metrics.thisMonth.bugsClosed++;
      }
    }
  }
}

// Merge two metrics objects (used for multi-batch accumulation)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function mergeMetrics(target: BatchMetrics, source: BatchMetrics): BatchMetrics {
  // Sum numeric values
  target.totalIssues += source.totalIssues;
  target.unassigned += source.unassigned;

  // Merge counts
  Object.entries(source.byStatus).forEach(([k, v]) => {
    target.byStatus[k] = (target.byStatus[k] || 0) + v;
  });
  Object.entries(source.byPriority).forEach(([k, v]) => {
    target.byPriority[k] = (target.byPriority[k] || 0) + v;
  });
  Object.entries(source.byType).forEach(([k, v]) => {
    target.byType[k] = (target.byType[k] || 0) + v;
  });
  Object.entries(source.byAssignee).forEach(([k, v]) => {
    target.byAssignee[k] = (target.byAssignee[k] || 0) + v;
  });
  Object.entries(source.bugs.byPriority).forEach(([k, v]) => {
    target.bugs.byPriority[k] = (target.bugs.byPriority[k] || 0) + v;
  });

  // Merge this month
  target.thisMonth.created += source.thisMonth.created;
  target.thisMonth.closed += source.thisMonth.closed;
  target.thisMonth.bugsCreated += source.thisMonth.bugsCreated;
  target.thisMonth.bugsClosed += source.thisMonth.bugsClosed;

  // Merge bugs
  target.bugs.total += source.bugs.total;
  target.bugs.open += source.bugs.open;

  // Merge work types
  target.epics.completed += source.epics.completed;
  target.epics.inProgress += source.epics.inProgress;
  target.epics.blocked += source.epics.blocked;

  target.stories.completed += source.stories.completed;
  target.stories.inProgress += source.stories.inProgress;
  target.stories.storyPointsDelivered += source.stories.storyPointsDelivered;

  target.tasks.completed += source.tasks.completed;
  target.tasks.inProgress += source.tasks.inProgress;
  target.tasks.overdue += source.tasks.overdue;

  target.spikes.completed += source.spikes.completed;
  target.spikes.inFlight += source.spikes.inFlight;
  target.spikes.pending += source.spikes.pending;

  target.risks.new += source.risks.new;
  target.risks.active += source.risks.active;
  target.risks.mitigated += source.risks.mitigated;

  target.adrs.approved += source.adrs.approved;
  target.adrs.pendingReview += source.adrs.pendingReview;
  target.adrs.inProgress += source.adrs.inProgress;

  target.escalatedDefects.active += source.escalatedDefects.active;

  target.initiatives.delivered += source.initiatives.delivered;
  target.initiatives.atRisk += source.initiatives.atRisk;

  // Merge top lists
  target.topOpenBugs = [...target.topOpenBugs, ...source.topOpenBugs]
    .sort((a, b) => {
      const priorityOrder: Record<string, number> = {
        'Highest': 0, 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'Lowest': 4
      };
      return (priorityOrder[a.priority] || 5) - (priorityOrder[b.priority] || 5);
    })
    .slice(0, 20);

  target.topUnassignedIssues = [...target.topUnassignedIssues, ...source.topUnassignedIssues]
    .slice(0, 20);

  target.topRecentIssues = [...target.topRecentIssues, ...source.topRecentIssues]
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .slice(0, 30);

  // Merge cycle times
  target.cycleTimeSums.epicCycleTimes.push(...source.cycleTimeSums.epicCycleTimes);
  target.cycleTimeSums.storyCycleTimes.push(...source.cycleTimeSums.storyCycleTimes);
  target.cycleTimeSums.bugAges.push(...source.cycleTimeSums.bugAges);
  target.cycleTimeSums.bugResolutionTimes.push(...source.cycleTimeSums.bugResolutionTimes);

  return target;
}

export const handler = async (event: ProcessBatchInput): Promise<ProcessBatchOutput> => {
  console.log('Processing batch:', JSON.stringify(event, null, 2));

  const { uploadId, timestamp, bucket, key, fileName, startRow, batchSize, accumulatedMetrics } = event;

  try {
    // PHASE 3 OPTIMIZATION: Calculate metrics in-flight, no DynamoDB writes!
    console.log(`🚀 PHASE 3: Processing batch ${startRow} - calculating metrics in-flight`);

    // Initialize or carry forward metrics
    const metrics: BatchMetrics = accumulatedMetrics ?
      JSON.parse(JSON.stringify(accumulatedMetrics)) as BatchMetrics :
      initializeMetrics();

    const now = new Date();

    // Get CSV from S3
    const getObjectResponse = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    if (!getObjectResponse.Body) {
      throw new Error('No body in S3 response');
    }

    // Parse CSV and calculate metrics in-flight
    const issues: JiraIssue[] = [];
    const bodyStream = getObjectResponse.Body;

    if (!(bodyStream instanceof Readable)) {
      throw new Error('S3 response body is not a readable stream');
    }

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
      escape: '"',
      quote: '"',
    });

    let rowCount = 0;
    let recordIndex = 1;

    for await (const row of bodyStream.pipe(parser)) {
      // Skip records before startRow
      if (recordIndex < startRow) {
        recordIndex++;
        continue;
      }

      // Stop if we've processed batchSize records
      if (rowCount >= batchSize) {
        parser.destroy();
        bodyStream.destroy();
        break;
      }

      recordIndex++;
      rowCount++;

      try {
        const record = row as CsvRecord;

        const issue: JiraIssue = {
          summary: record['Summary'] || '',
          issueKey: record['Issue key'] || '',
          issueId: record['Issue id'] || '',
          issueType: record['Issue Type'] || '',
          status: record['Status'] || '',
          priority: record['Priority'] || '',
          assignee: record['Assignee'] || 'Unassigned',
          created: record['Created'] || '',
          updated: record['Updated'] || '',
          resolved: record['Resolved'] || undefined,
          projectKey: record['Project key'] || '',
          projectName: record['Project name'] || '',
          ...record,
        };

        issues.push(issue);

        // PHASE 3: Process issue and update metrics (NO DynamoDB write!)
        processIssue(issue, metrics, now);
      } catch (error) {
        console.error(`Error parsing CSV record ${recordIndex}:`, error);
      }
    }

    parser.destroy();
    bodyStream.destroy();

    console.log(`✅ Processed ${issues.length} issues - metrics calculated in memory`);
    console.log(`📊 Total issues so far: ${metrics.totalIssues}`);

    // Determine if there are more rows to process
    const totalRows = event.totalRows || (startRow + issues.length);
    const hasMore = issues.length === batchSize;
    const nextStartRow = hasMore ? startRow + batchSize : undefined;

    // OPTIMIZATION: Only update progress every 1000 rows or at completion
    const shouldUpdateProgress = (startRow % 1000 === 0) || !hasMore;

    if (shouldUpdateProgress) {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: UPLOADS_TABLE,
          Key: {
            uploadId,
            timestamp,
          },
          UpdateExpression: 'SET processedIssues = :processed, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':processed': metrics.totalIssues,
            ':updatedAt': new Date().toISOString(),
          },
        })
      );
      console.log(`Progress updated: ${metrics.totalIssues} issues processed`);
    } else {
      console.log(`Progress not updated (will update at next milestone): ${metrics.totalIssues} issues processed`);
    }

    // Publish cost optimization metrics
    await publishMetrics(shouldUpdateProgress ? 1 : 0, true);

    console.log(`✅ Batch complete: processed ${issues.length} issues, hasMore: ${hasMore}`);

    return {
      uploadId,
      timestamp,
      bucket,
      key,
      fileName,
      startRow,
      batchSize,
      totalRows,
      processedRows: issues.length,
      hasMore,
      nextStartRow,
      batchMetrics: metrics, // Pass metrics to next batch or finalize
    };
  } catch (error) {
    console.error(`❌ BATCH PROCESSING ERROR:`);
    console.error(`Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`Error message: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
    console.error(`Batch context: uploadId=${uploadId}, startRow=${startRow}, batchSize=${batchSize}`);
    throw error;
  }
};
