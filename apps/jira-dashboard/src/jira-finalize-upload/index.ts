import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({});
const dynamoClient = DynamoDBDocumentClient.from(ddbClient);

const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;

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

interface FinalizeInput {
  uploadId: string;
  timestamp: string;
  fileName: string;
  batchMetrics: BatchMetrics; // PHASE 3: Receive accumulated metrics from batches
}

export const handler = async (event: FinalizeInput): Promise<{ status: string }> => {
  console.log('🎯 PHASE 3: Finalizing upload with pre-calculated metrics');
  console.log('Metrics received:', JSON.stringify({
    totalIssues: event.batchMetrics?.totalIssues,
    hasTopLists: {
      openBugs: event.batchMetrics?.topOpenBugs?.length,
      unassigned: event.batchMetrics?.topUnassignedIssues?.length,
      recent: event.batchMetrics?.topRecentIssues?.length,
    }
  }, null, 2));

  const { uploadId, timestamp, fileName, batchMetrics } = event;

  try {
    // PHASE 3: No more querying 9,677 issues from DynamoDB!
    // All metrics were calculated during batch processing

    if (!batchMetrics) {
      throw new Error('No batch metrics received - this should not happen in Phase 3');
    }

    console.log(`✅ Received metrics for ${batchMetrics.totalIssues} total issues`);

    // Calculate final aggregated metrics with averages
    const finalMetrics = calculateFinalMetrics(batchMetrics);

    // Trim top lists to final size
    const topLists = {
      openBugs: batchMetrics.topOpenBugs.slice(0, 10),
      unassignedIssues: batchMetrics.topUnassignedIssues.slice(0, 10),
      recentIssues: batchMetrics.topRecentIssues.slice(0, 20),
    };

    console.log(`📊 Final lists: ${topLists.openBugs.length} open bugs, ${topLists.unassignedIssues.length} unassigned, ${topLists.recentIssues.length} recent`);

    // Extract jiraBaseUrl from first issue if available
    let jiraBaseUrl = 'https://vocovo.atlassian.net'; // Default
    const firstIssue = topLists.recentIssues[0] || topLists.openBugs[0] || topLists.unassignedIssues[0];
    if (firstIssue) {
      // Could extract from issue data if available
      jiraBaseUrl = 'https://vocovo.atlassian.net';
    }

    // Update upload status to completed with metrics
    await dynamoClient.send(
      new UpdateCommand({
        TableName: UPLOADS_TABLE,
        Key: {
          uploadId,
          timestamp,
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, totalIssues = :totalIssues, #metrics = :metrics, fileName = :fileName, processedIssues = :processedIssues, jiraBaseUrl = :jiraBaseUrl, topLists = :topLists',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#metrics': 'metrics',
        },
        ExpressionAttributeValues: {
          ':status': 'completed',
          ':updatedAt': new Date().toISOString(),
          ':totalIssues': batchMetrics.totalIssues,
          ':metrics': finalMetrics,
          ':fileName': fileName,
          ':processedIssues': batchMetrics.totalIssues,
          ':jiraBaseUrl': jiraBaseUrl,
          ':topLists': topLists, // PHASE 3: Store pre-computed top lists
        },
      })
    );

    console.log(`✅ PHASE 3 SUCCESS: Upload finalized with ${batchMetrics.totalIssues} issues - NO DynamoDB READS!`);
    console.log(`💰 Cost savings: 0 read capacity units (vs ${Math.ceil(batchMetrics.totalIssues / 100)} RCUs in old approach)`);

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

function calculateFinalMetrics(batchMetrics: BatchMetrics) {
  // Calculate averages from cycle time sums
  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const epicAvgCycleTime = Math.round(avg(batchMetrics.cycleTimeSums.epicCycleTimes));
  const storyAvgCycleTime = Math.round(avg(batchMetrics.cycleTimeSums.storyCycleTimes));
  const bugAvgAge = Math.round(avg(batchMetrics.cycleTimeSums.bugAges));
  const bugAvgResolutionTime = Math.round(avg(batchMetrics.cycleTimeSums.bugResolutionTimes));

  // Calculate completion rates
  const totalEpics = batchMetrics.epics.completed + batchMetrics.epics.inProgress + batchMetrics.epics.blocked;
  const epicCompletionRate = totalEpics > 0 ? Math.round((batchMetrics.epics.completed / totalEpics) * 100) : 0;

  const totalTasks = batchMetrics.tasks.completed + batchMetrics.tasks.inProgress;
  const taskCompletionRate = totalTasks > 0 ? Math.round((batchMetrics.tasks.completed / totalTasks) * 100) : 0;

  // Bug trend
  const bugBacklogGrowth = batchMetrics.thisMonth.bugsCreated - batchMetrics.thisMonth.bugsClosed;
  const bugTrend: 'improving' | 'degrading' | 'stable' =
    bugBacklogGrowth < 0 ? 'improving' : bugBacklogGrowth > 0 ? 'degrading' : 'stable';

  // Epic health (simple heuristic)
  const epicHealth = {
    onTrack: batchMetrics.epics.completed,
    atRisk: batchMetrics.epics.inProgress > 0 ? Math.floor(batchMetrics.epics.inProgress * 0.3) : 0,
    delayed: batchMetrics.epics.blocked,
  };

  // Story status breakdown
  const storyByStatus = {
    toDo: 0, // Would need more data from batch processing
    inProgress: batchMetrics.stories.inProgress,
    done: batchMetrics.stories.completed,
    blocked: 0,
  };

  // Bug metrics by severity
  const bugBySeverity: Record<string, number> = {};
  Object.entries(batchMetrics.bugs.byPriority).forEach(([priority, count]) => {
    const severityLower = priority.toLowerCase();
    if (severityLower.includes('critical') || severityLower === 'highest') {
      bugBySeverity.critical = (bugBySeverity.critical || 0) + count;
    } else if (severityLower.includes('high')) {
      bugBySeverity.high = (bugBySeverity.high || 0) + count;
    } else if (severityLower.includes('medium')) {
      bugBySeverity.medium = (bugBySeverity.medium || 0) + count;
    } else {
      bugBySeverity.low = (bugBySeverity.low || 0) + count;
    }
  });

  return {
    totalIssues: batchMetrics.totalIssues,
    byStatus: batchMetrics.byStatus,
    byPriority: batchMetrics.byPriority,
    byType: batchMetrics.byType,
    byAssignee: batchMetrics.byAssignee,
    unassigned: batchMetrics.unassigned,

    bugs: {
      total: batchMetrics.bugs.total,
      open: batchMetrics.bugs.open,
      byPriority: batchMetrics.bugs.byPriority,
      bySeverity: bugBySeverity,
    },

    thisMonth: batchMetrics.thisMonth,

    // Work type metrics with calculated values
    epics: {
      completed: batchMetrics.epics.completed,
      inProgress: batchMetrics.epics.inProgress,
      blocked: batchMetrics.epics.blocked,
      completionRate: epicCompletionRate,
      avgCycleTime: epicAvgCycleTime,
      health: epicHealth,
    },

    stories: {
      completed: batchMetrics.stories.completed,
      storyPointsDelivered: batchMetrics.stories.storyPointsDelivered,
      inProgress: batchMetrics.stories.inProgress,
      throughput: batchMetrics.stories.completed,
      avgCycleTime: storyAvgCycleTime,
      byStatus: storyByStatus,
    },

    tasks: {
      completed: batchMetrics.tasks.completed,
      inProgress: batchMetrics.tasks.inProgress,
      completionRate: taskCompletionRate,
      overdue: batchMetrics.tasks.overdue,
      distributionByParent: {}, // Would need more tracking
    },

    bugMetrics: {
      openBySeverity: {
        critical: bugBySeverity.critical || 0,
        high: bugBySeverity.high || 0,
        medium: bugBySeverity.medium || 0,
        low: bugBySeverity.low || 0,
      },
      createdVsClosed: {
        created: batchMetrics.thisMonth.bugsCreated,
        closed: batchMetrics.thisMonth.bugsClosed,
        trend: bugTrend,
      },
      avgAge: bugAvgAge,
      avgResolutionTime: bugAvgResolutionTime,
      backlogGrowth: bugBacklogGrowth,
      escapedDefects: 0, // Would need label tracking
      byComponent: {}, // Would need component tracking
    },

    spikes: {
      inFlight: batchMetrics.spikes.inFlight,
      completed: batchMetrics.spikes.completed,
      pending: batchMetrics.spikes.pending,
      avgDuration: 0, // Could calculate if needed
      outcomes: { ledToStory: 0, noAction: 0, blocked: 0 },
    },

    risks: {
      new: batchMetrics.risks.new,
      active: batchMetrics.risks.active,
      mitigated: batchMetrics.risks.mitigated,
      avgAge: 0,
      bySeverity: { high: 0, medium: 0, low: 0 },
      byCategory: {},
    },

    adrs: {
      approved: batchMetrics.adrs.approved,
      pendingReview: batchMetrics.adrs.pendingReview,
      inProgress: batchMetrics.adrs.inProgress,
      avgDecisionVelocity: 0,
      byCategory: {},
    },

    escalatedDefects: {
      active: batchMetrics.escalatedDefects.active,
      avgResolutionTime: 0,
      bySeverity: { p0: 0, p1: 0, p2: 0 },
      avgAge: 0,
      bySource: { customer: 0, internal: 0, security: 0 },
    },

    initiatives: {
      delivered: batchMetrics.initiatives.delivered,
      avgProgress: 0,
      atRisk: batchMetrics.initiatives.atRisk,
      avgROI: 0,
      dependencyHealth: { blocked: 0, onTrack: 0 },
    },
  };
}
