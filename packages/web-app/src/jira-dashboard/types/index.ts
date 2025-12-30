export interface Upload {
  uploadId: string;
  timestamp: string;
  fileName: string;
  description?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalIssues?: number;
  createdAt: string;
  updatedAt?: string;
  errorMessage?: string;
  metrics?: Metrics;
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
  [key: string]: any;
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

export interface HistoricalData {
  trends: {
    totalIssuesOverTime: Array<{ date: string; fileName: string; totalIssues: number }>;
    bugsOverTime: Array<{ date: string; fileName: string; totalBugs: number; openBugs: number }>;
    issuesCreatedPerMonth: Array<{ date: string; fileName: string; created: number; closed: number }>;
    statusTrends: Array<{ date: string; fileName: string; [key: string]: any }>;
    priorityTrends: Array<{ date: string; fileName: string; [key: string]: any }>;
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
