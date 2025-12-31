import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({});
const dynamoClient = DynamoDBDocumentClient.from(ddbClient);

const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;
const ISSUES_TABLE = process.env.ISSUES_TABLE!;

interface JiraIssue {
  issueKey: string;
  issueType: string;
  status: string;
  priority: string;
  assignee: string;
  created: string;
  resolved?: string;
  [key: string]: string | undefined;
}

interface FinalizeInput {
  uploadId: string;
  timestamp: string;
  fileName: string;
}

export const handler = async (event: FinalizeInput): Promise<{ status: string }> => {
  console.log('Finalizing upload:', JSON.stringify(event, null, 2));

  const { uploadId, timestamp, fileName } = event;

  try {
    // Query all issues for this upload to calculate metrics
    const issues: JiraIssue[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: ISSUES_TABLE,
          IndexName: 'UploadIndex',
          KeyConditionExpression: 'uploadId = :uploadId',
          ExpressionAttributeValues: {
            ':uploadId': uploadId,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (result.Items) {
        issues.push(...(result.Items as JiraIssue[]));
      }

      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    console.log(`Found ${issues.length} total issues for upload ${uploadId}`);

    // Calculate metrics
    const metrics = calculateMetrics(issues);

    // Determine Jira base URL from first issue's project URL or construct from project key
    let jiraBaseUrl = '';
    if (issues.length > 0) {
      const firstIssue = issues[0];
      // Try to get from Project url column
      if (firstIssue['Project url']) {
        jiraBaseUrl = firstIssue['Project url'];
      } else if (firstIssue.issueKey) {
        // Extract domain from issue key pattern (e.g., "DEV-3774" -> assume vocovo.atlassian.net)
        // For now, we'll use a default pattern - in production, this should be configurable
        jiraBaseUrl = 'https://vocovo.atlassian.net';
      }
    }

    // Update upload status to completed with metrics
    await dynamoClient.send(
      new UpdateCommand({
        TableName: UPLOADS_TABLE,
        Key: {
          uploadId,
          timestamp,
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, totalIssues = :totalIssues, #metrics = :metrics, fileName = :fileName, processedIssues = :processedIssues, jiraBaseUrl = :jiraBaseUrl',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#metrics': 'metrics',
        },
        ExpressionAttributeValues: {
          ':status': 'completed',
          ':updatedAt': new Date().toISOString(),
          ':totalIssues': issues.length,
          ':metrics': metrics,
          ':fileName': fileName,
          ':processedIssues': issues.length,
          ':jiraBaseUrl': jiraBaseUrl,
        },
      })
    );

    console.log(`Successfully finalized upload ${uploadId} with ${issues.length} issues`);

    return { status: 'completed' };
  } catch (error) {
    console.error(`❌ FINALIZE ERROR:`);
    console.error(`Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`Error message: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
    console.error(`Finalize context: uploadId=${uploadId}, fileName=${fileName}`);

    // Update upload status to failed
    try {
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
    } catch (updateError) {
      console.error('Error updating upload status to failed:', updateError);
    }

    throw error;
  }
};

function calculateMetrics(issues: JiraIssue[]) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const metrics = {
    totalIssues: issues.length,
    byStatus: {} as Record<string, number>,
    byPriority: {} as Record<string, number>,
    byType: {} as Record<string, number>,
    byAssignee: {} as Record<string, number>,
    bugs: {
      total: 0,
      open: 0,
      bySeverity: {} as Record<string, number>,
      byPriority: {} as Record<string, number>,
    },
    thisMonth: {
      created: 0,
      closed: 0,
      bugsCreated: 0,
      bugsClosed: 0,
    },
    unassigned: 0,

    // Work type specific metrics
    epics: {
      completed: 0,
      inProgress: 0,
      blocked: 0,
      completionRate: 0,
      avgCycleTime: 0,
      health: { onTrack: 0, atRisk: 0, delayed: 0 },
    },
    stories: {
      completed: 0,
      storyPointsDelivered: 0,
      inProgress: 0,
      throughput: 0,
      avgCycleTime: 0,
      byStatus: { toDo: 0, inProgress: 0, done: 0, blocked: 0 },
    },
    tasks: {
      completed: 0,
      inProgress: 0,
      completionRate: 0,
      overdue: 0,
      distributionByParent: {} as Record<string, number>,
    },
    bugMetrics: {
      openBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      createdVsClosed: { created: 0, closed: 0, trend: 'stable' as 'stable' | 'improving' | 'degrading' },
      avgAge: 0,
      avgResolutionTime: 0,
      backlogGrowth: 0,
      escapedDefects: 0,
      byComponent: {} as Record<string, number>,
    },
    spikes: {
      inFlight: 0,
      completed: 0,
      pending: 0,
      avgDuration: 0,
      outcomes: { ledToStory: 0, noAction: 0, blocked: 0 },
    },
    risks: {
      new: 0,
      active: 0,
      mitigated: 0,
      avgAge: 0,
      bySeverity: { high: 0, medium: 0, low: 0 },
      byCategory: {} as Record<string, number>,
    },
    adrs: {
      approved: 0,
      pendingReview: 0,
      inProgress: 0,
      avgDecisionVelocity: 0,
      byCategory: {} as Record<string, number>,
    },
    escalatedDefects: {
      active: 0,
      avgResolutionTime: 0,
      bySeverity: { p0: 0, p1: 0, p2: 0 },
      avgAge: 0,
      bySource: { customer: 0, internal: 0, security: 0 },
    },
    initiatives: {
      delivered: 0,
      avgProgress: 0,
      atRisk: 0,
      avgROI: 0,
      dependencyHealth: { blocked: 0, onTrack: 0 },
    },
  };

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

  // Temporary arrays for cycle time calculations
  const epicCycleTimes: number[] = [];
  const storyCycleTimes: number[] = [];
  const bugAges: number[] = [];
  const bugResolutionTimes: number[] = [];
  const riskAges: number[] = [];
  const adrVelocities: number[] = [];
  const escalatedAges: number[] = [];
  const escalatedResolutionTimes: number[] = [];
  const spikeDurations: number[] = [];

  issues.forEach((issue) => {
    const issueType = issue.issueType?.toLowerCase() || '';
    const status = issue.status || '';
    const priority = issue.priority || '';

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

    // === EPIC METRICS ===
    if (issueType === 'epic') {
      if (isDone(status)) {
        metrics.epics.completed++;
        // Calculate cycle time if we have created and resolved dates
        if (issue.created && issue.resolved) {
          epicCycleTimes.push(daysBetween(issue.created, issue.resolved));
        }
      } else if (isInProgress(status)) {
        metrics.epics.inProgress++;
      }

      if (isBlocked(status)) {
        metrics.epics.blocked++;
      }

      // Calculate epic health (simple heuristic based on age and status)
      if (issue.created) {
        const age = daysBetween(issue.created, now.toISOString());
        if (isDone(status)) {
          metrics.epics.health.onTrack++;
        } else if (age > 90 || isBlocked(status)) {
          metrics.epics.health.delayed++;
        } else if (age > 60) {
          metrics.epics.health.atRisk++;
        } else {
          metrics.epics.health.onTrack++;
        }
      }
    }

    // === STORY METRICS ===
    if (issueType === 'story') {
      if (isDone(status)) {
        metrics.stories.completed++;
        // Try to extract story points if available
        const storyPoints = parseFloat(issue['Story Points'] || '0');
        if (storyPoints > 0) {
          metrics.stories.storyPointsDelivered += storyPoints;
        }
        if (issue.created && issue.resolved) {
          storyCycleTimes.push(daysBetween(issue.created, issue.resolved));
        }
      } else if (isInProgress(status)) {
        metrics.stories.inProgress++;
      }

      if (isDone(status)) {
        metrics.stories.byStatus.done++;
      } else if (isInProgress(status)) {
        metrics.stories.byStatus.inProgress++;
      } else if (isBlocked(status)) {
        metrics.stories.byStatus.blocked++;
      } else {
        metrics.stories.byStatus.toDo++;
      }
    }

    // === TASK METRICS ===
    if (issueType === 'task') {
      if (isDone(status)) {
        metrics.tasks.completed++;
      } else if (isInProgress(status)) {
        metrics.tasks.inProgress++;
      }

      // Check if overdue (if we have a due date field)
      if (issue['Due date']) {
        const dueDate = new Date(issue['Due date']);
        if (dueDate < now && !isDone(status)) {
          metrics.tasks.overdue++;
        }
      }

      // Distribution by parent epic/story
      const parent = issue['Parent'] || 'Unlinked';
      metrics.tasks.distributionByParent[parent] = (metrics.tasks.distributionByParent[parent] || 0) + 1;
    }

    // === BUG METRICS ===
    if (issueType.includes('bug') || issueType === 'escalated defect') {
      metrics.bugs.total++;

      const isOpen = !isDone(status);
      if (isOpen) {
        metrics.bugs.open++;
      }

      if (issue.priority) {
        metrics.bugs.byPriority[issue.priority] = (metrics.bugs.byPriority[issue.priority] || 0) + 1;
      }

      // Detailed bug metrics
      const severityLower = priority.toLowerCase();
      if (severityLower.includes('critical') || severityLower === 'highest') {
        metrics.bugMetrics.openBySeverity.critical += isOpen ? 1 : 0;
      } else if (severityLower.includes('high')) {
        metrics.bugMetrics.openBySeverity.high += isOpen ? 1 : 0;
      } else if (severityLower.includes('medium')) {
        metrics.bugMetrics.openBySeverity.medium += isOpen ? 1 : 0;
      } else {
        metrics.bugMetrics.openBySeverity.low += isOpen ? 1 : 0;
      }

      // Bug age
      if (issue.created && isOpen) {
        const age = daysBetween(issue.created, now.toISOString());
        bugAges.push(age);
      }

      // Bug resolution time
      if (issue.created && issue.resolved) {
        bugResolutionTimes.push(daysBetween(issue.created, issue.resolved));
      }

      // Component tracking
      const component = issue['Component/s'] || issue['Components'] || 'Unknown';
      metrics.bugMetrics.byComponent[component] = (metrics.bugMetrics.byComponent[component] || 0) + 1;

      // Escaped defects (found in production) - check for labels or environment
      const labels = issue['Labels'] || '';
      const env = issue['Environment'] || '';
      if (labels.toLowerCase().includes('production') || env.toLowerCase().includes('production')) {
        metrics.bugMetrics.escapedDefects++;
      }
    }

    // === SPIKE METRICS ===
    if (issueType === 'spike') {
      if (isDone(status)) {
        metrics.spikes.completed++;
        if (issue.created && issue.resolved) {
          spikeDurations.push(daysBetween(issue.created, issue.resolved));
        }
        // Check outcome (simplified - would need custom fields in real scenario)
        const resolution = issue['Resolution'] || '';
        if (resolution.toLowerCase().includes('story') || resolution.toLowerCase().includes('follow')) {
          metrics.spikes.outcomes.ledToStory++;
        } else if (resolution.toLowerCase().includes('block')) {
          metrics.spikes.outcomes.blocked++;
        } else {
          metrics.spikes.outcomes.noAction++;
        }
      } else if (isInProgress(status)) {
        metrics.spikes.inFlight++;
      } else {
        metrics.spikes.pending++;
      }
    }

    // === RISK METRICS ===
    if (issueType === 'risk') {
      if (isDone(status) || status.toLowerCase().includes('mitigated')) {
        metrics.risks.mitigated++;
      } else if (isInProgress(status) || status.toLowerCase().includes('active')) {
        metrics.risks.active++;
      } else {
        metrics.risks.new++;
      }

      // Risk age
      if (issue.created && !isDone(status)) {
        riskAges.push(daysBetween(issue.created, now.toISOString()));
      }

      // Risk severity
      const severityLower = priority.toLowerCase();
      if (severityLower.includes('high') || severityLower === 'highest') {
        metrics.risks.bySeverity.high++;
      } else if (severityLower.includes('medium')) {
        metrics.risks.bySeverity.medium++;
      } else {
        metrics.risks.bySeverity.low++;
      }

      // Risk category
      const category = issue['Risk Category'] || issue['Category'] || 'Uncategorized';
      metrics.risks.byCategory[category] = (metrics.risks.byCategory[category] || 0) + 1;
    }

    // === ADR METRICS ===
    if (issueType === 'adr' || issueType.includes('decision')) {
      if (status.toLowerCase().includes('approved')) {
        metrics.adrs.approved++;
        if (issue.created && issue.resolved) {
          adrVelocities.push(daysBetween(issue.created, issue.resolved));
        }
      } else if (status.toLowerCase().includes('review')) {
        metrics.adrs.pendingReview++;
      } else {
        metrics.adrs.inProgress++;
      }

      // ADR category
      const category = issue['Decision Category'] || issue['Category'] || 'General';
      metrics.adrs.byCategory[category] = (metrics.adrs.byCategory[category] || 0) + 1;
    }

    // === ESCALATED DEFECT METRICS ===
    if (issueType === 'escalated defect') {
      if (!isDone(status)) {
        metrics.escalatedDefects.active++;

        // Age in hours
        if (issue.created) {
          const ageHours = daysBetween(issue.created, now.toISOString()) * 24;
          escalatedAges.push(ageHours);
        }
      } else if (issue.created && issue.resolved) {
        // Resolution time in hours
        escalatedResolutionTimes.push(daysBetween(issue.created, issue.resolved) * 24);
      }

      // Severity (P0, P1, P2)
      if (priority.toLowerCase().includes('p0') || priority === 'Highest') {
        metrics.escalatedDefects.bySeverity.p0++;
      } else if (priority.toLowerCase().includes('p1') || priority === 'High') {
        metrics.escalatedDefects.bySeverity.p1++;
      } else {
        metrics.escalatedDefects.bySeverity.p2++;
      }

      // Source
      const source = issue['Defect Source'] || issue['Reporter Type'] || '';
      if (source.toLowerCase().includes('customer')) {
        metrics.escalatedDefects.bySource.customer++;
      } else if (source.toLowerCase().includes('security')) {
        metrics.escalatedDefects.bySource.security++;
      } else {
        metrics.escalatedDefects.bySource.internal++;
      }
    }

    // === INITIATIVE METRICS ===
    if (issueType === 'initiative') {
      if (isDone(status)) {
        metrics.initiatives.delivered++;
      }

      // Check if at risk
      if (isBlocked(status) || status.toLowerCase().includes('risk')) {
        metrics.initiatives.atRisk++;
      }

      // Progress (if we have a % complete field)
      const progress = parseFloat(issue['% Complete'] || issue['Progress'] || '0');
      if (progress > 0) {
        metrics.initiatives.avgProgress += progress;
      }

      // ROI (if tracked)
      const roi = parseFloat(issue['ROI'] || '0');
      if (roi > 0) {
        metrics.initiatives.avgROI += roi;
      }

      // Dependency health
      if (isBlocked(status)) {
        metrics.initiatives.dependencyHealth.blocked++;
      } else {
        metrics.initiatives.dependencyHealth.onTrack++;
      }
    }

    // This month metrics
    if (issue.created) {
      const createdDate = new Date(issue.created);
      if (createdDate.getMonth() === currentMonth && createdDate.getFullYear() === currentYear) {
        metrics.thisMonth.created++;
        if (issueType.includes('bug')) {
          metrics.thisMonth.bugsCreated++;
        }
      }
    }

    if (issue.resolved) {
      const resolvedDate = new Date(issue.resolved);
      if (resolvedDate.getMonth() === currentMonth && resolvedDate.getFullYear() === currentYear) {
        metrics.thisMonth.closed++;
        if (issueType.includes('bug')) {
          metrics.thisMonth.bugsClosed++;
        }
      }
    }
  });

  // Calculate averages
  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  metrics.epics.avgCycleTime = Math.round(avg(epicCycleTimes));
  const totalEpics = metrics.epics.completed + metrics.epics.inProgress + metrics.epics.blocked;
  metrics.epics.completionRate = totalEpics > 0 ? Math.round((metrics.epics.completed / totalEpics) * 100) : 0;

  metrics.stories.avgCycleTime = Math.round(avg(storyCycleTimes));
  // Throughput: completed stories per week (assuming snapshot represents 1 week)
  metrics.stories.throughput = metrics.stories.completed;

  const totalTasks = metrics.tasks.completed + metrics.tasks.inProgress;
  metrics.tasks.completionRate = totalTasks > 0 ? Math.round((metrics.tasks.completed / totalTasks) * 100) : 0;

  metrics.bugMetrics.avgAge = Math.round(avg(bugAges));
  metrics.bugMetrics.avgResolutionTime = Math.round(avg(bugResolutionTimes));
  metrics.bugMetrics.createdVsClosed.created = metrics.thisMonth.bugsCreated;
  metrics.bugMetrics.createdVsClosed.closed = metrics.thisMonth.bugsClosed;
  metrics.bugMetrics.backlogGrowth = metrics.thisMonth.bugsCreated - metrics.thisMonth.bugsClosed;
  metrics.bugMetrics.createdVsClosed.trend =
    metrics.bugMetrics.backlogGrowth < 0 ? 'improving' : metrics.bugMetrics.backlogGrowth > 0 ? 'degrading' : 'stable';

  metrics.spikes.avgDuration = Math.round(avg(spikeDurations));

  metrics.risks.avgAge = Math.round(avg(riskAges));

  metrics.adrs.avgDecisionVelocity = Math.round(avg(adrVelocities));

  metrics.escalatedDefects.avgAge = Math.round(avg(escalatedAges));
  metrics.escalatedDefects.avgResolutionTime = Math.round(avg(escalatedResolutionTimes));

  const totalInitiatives = metrics.initiatives.delivered + metrics.initiatives.atRisk;
  if (totalInitiatives > 0) {
    metrics.initiatives.avgProgress = Math.round(metrics.initiatives.avgProgress / totalInitiatives);
    metrics.initiatives.avgROI = Math.round(metrics.initiatives.avgROI / totalInitiatives);
  }

  return metrics;
}
