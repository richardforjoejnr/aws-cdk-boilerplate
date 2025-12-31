export interface Upload {
  uploadId: string;
  timestamp: string;
  fileName: string;
  description?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalIssues?: number;
  processedIssues?: number;
  createdAt: string;
  updatedAt?: string;
  errorMessage?: string;
  metrics?: Metrics;
  jiraBaseUrl?: string;
}

export interface Metrics {
  totalIssues: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byType: Record<string, number>;
  byAssignee: Record<string, number>;
  bugs: {
    total: number;
    open: number;
    bySeverity: Record<string, number>;
    byPriority: Record<string, number>;
  };
  thisMonth: {
    created: number;
    closed: number;
    bugsCreated: number;
    bugsClosed: number;
  };
  unassigned: number;

  // Epic Metrics (Strategic Value)
  epics?: {
    completed: number;
    inProgress: number;
    blocked: number;
    completionRate: number; // % completed
    avgCycleTime: number; // days
    health: {
      onTrack: number;
      atRisk: number;
      delayed: number;
    };
  };

  // Story Metrics (Feature Value)
  stories?: {
    completed: number;
    storyPointsDelivered: number;
    inProgress: number;
    throughput: number; // per week
    avgCycleTime: number; // days
    byStatus: {
      toDo: number;
      inProgress: number;
      done: number;
      blocked: number;
    };
  };

  // Task Metrics (Execution Value)
  tasks?: {
    completed: number;
    inProgress: number;
    completionRate: number; // %
    overdue: number;
    distributionByParent: Record<string, number>;
  };

  // Bug Metrics (Quality)
  bugMetrics?: {
    openBySeverity: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    createdVsClosed: {
      created: number;
      closed: number;
      trend: 'improving' | 'degrading' | 'stable';
    };
    avgAge: number; // days
    avgResolutionTime: number; // days
    backlogGrowth: number; // net change
    escapedDefects: number;
    byComponent: Record<string, number>;
  };

  // Spike Metrics (Research & Risk Reduction)
  spikes?: {
    inFlight: number;
    completed: number;
    pending: number;
    avgDuration: number; // days
    outcomes: {
      ledToStory: number;
      noAction: number;
      blocked: number;
    };
  };

  // Risk Metrics (Risk Management)
  risks?: {
    new: number;
    active: number;
    mitigated: number;
    avgAge: number; // days
    bySeverity: {
      high: number;
      medium: number;
      low: number;
    };
    byCategory: Record<string, number>;
  };

  // ADR Metrics (Technical Governance)
  adrs?: {
    approved: number;
    pendingReview: number;
    inProgress: number;
    avgDecisionVelocity: number; // days from proposal to approval
    byCategory: Record<string, number>;
  };

  // Escalated Defect Metrics (Critical Issues)
  escalatedDefects?: {
    active: number;
    avgResolutionTime: number; // hours
    bySeverity: {
      p0: number;
      p1: number;
      p2: number;
    };
    avgAge: number; // hours
    bySource: {
      customer: number;
      internal: number;
      security: number;
    };
  };

  // Initiative Metrics (Business Outcomes)
  initiatives?: {
    delivered: number;
    avgProgress: number; // % complete
    atRisk: number;
    avgROI: number;
    dependencyHealth: {
      blocked: number;
      onTrack: number;
    };
  };
}

export interface JiraIssue {
  issueKey: string;
  uploadId: string;
  summary: string;
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

export interface DashboardData {
  upload: Upload;
  summary: Metrics;
  charts: {
    statusDistribution: ChartData[];
    priorityDistribution: ChartData[];
    typeDistribution: ChartData[];
    assigneeDistribution: ChartData[];
  };
  lists: {
    openBugs: JiraIssue[];
    recentIssues: JiraIssue[];
    unassignedIssues: JiraIssue[];
  };
}

export interface ChartData {
  name: string;
  value: number;
}

export interface TrendData {
  date: string;
  fileName: string;
  [key: string]: string | number;
}

export interface HistoricalData {
  trends: {
    totalIssuesOverTime: Array<{ date: string; fileName: string; totalIssues: number }>;
    bugsOverTime: Array<{ date: string; fileName: string; totalBugs: number; openBugs: number }>;
    issuesCreatedPerMonth: Array<{ date: string; fileName: string; created: number; closed: number }>;
    statusTrends: TrendData[];
    priorityTrends: TrendData[];
    unassignedTrends: Array<{ date: string; fileName: string; unassigned: number }>;
  };
  aggregateStats: {
    totalUploads: number;
    averageIssuesPerUpload: number;
    averageBugsPerUpload: number;
    latestUpload: Upload;
    oldestUpload: Upload;
  };
  uploads: Array<{ uploadId: string; timestamp: string; fileName: string; totalIssues: number }>;
}
