import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { DashboardData } from '../types';
import jiraApi from '../services/api';
import { format } from 'date-fns';

interface CurrentDashboardProps {
  uploadId: string;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1', '#d084d0'];

export const CurrentDashboard: React.FC<CurrentDashboardProps> = ({ uploadId }) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadDashboard();
    // Poll every 5 seconds if processing
    const interval = setInterval(() => {
      if (data?.upload.status === 'processing') {
        loadDashboard();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [uploadId]);

  const loadDashboard = async () => {
    try {
      const dashboardData = await jiraApi.getDashboardData(uploadId);
      setData(dashboardData);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading dashboard...</div>;
  }

  if (error) {
    return <div style={styles.error}>Error: {error}</div>;
  }

  if (!data) {
    return <div style={styles.error}>No data available</div>;
  }

  if (data.upload.status !== 'completed') {
    return (
      <div style={styles.processing}>
        <h2>Processing Upload...</h2>
        <p>Status: {data.upload.status}</p>
        <p>This may take a few minutes for large CSV files.</p>
      </div>
    );
  }

  const { summary, charts, lists, upload } = data;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Jira Dashboard</h1>
        <div style={styles.uploadInfo}>
          <p><strong>File:</strong> {upload.fileName}</p>
          <p><strong>Uploaded:</strong> {format(new Date(upload.createdAt), 'PPpp')}</p>
          <p><strong>Total Issues:</strong> {summary.totalIssues}</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={styles.summaryGrid}>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>This Month</h3>
          <div style={styles.statRow}>
            <div style={styles.stat}>
              <div style={styles.statValue}>{summary.thisMonth.created}</div>
              <div style={styles.statLabel}>Created</div>
            </div>
            <div style={styles.stat}>
              <div style={styles.statValue}>{summary.thisMonth.closed}</div>
              <div style={styles.statLabel}>Closed</div>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Bugs</h3>
          <div style={styles.statRow}>
            <div style={styles.stat}>
              <div style={styles.statValue}>{summary.bugs.total}</div>
              <div style={styles.statLabel}>Total</div>
            </div>
            <div style={styles.stat}>
              <div style={{ ...styles.statValue, color: '#ff4444' }}>{summary.bugs.open}</div>
              <div style={styles.statLabel}>Open</div>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Bugs This Month</h3>
          <div style={styles.statRow}>
            <div style={styles.stat}>
              <div style={styles.statValue}>{summary.thisMonth.bugsCreated}</div>
              <div style={styles.statLabel}>Created</div>
            </div>
            <div style={styles.stat}>
              <div style={styles.statValue}>{summary.thisMonth.bugsClosed}</div>
              <div style={styles.statLabel}>Closed</div>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Unassigned</h3>
          <div style={styles.stat}>
            <div style={{ ...styles.statValue, color: '#ff8800' }}>{summary.unassigned}</div>
            <div style={styles.statLabel}>Issues</div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div style={styles.chartsGrid}>
        {/* Status Distribution */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Status Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={charts.statusDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {charts.statusDistribution.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Priority Distribution */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Priority Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={charts.priorityDistribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#8884d8">
                {charts.priorityDistribution.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Issue Type Distribution */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Issue Type Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={charts.typeDistribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#82ca9d">
                {charts.typeDistribution.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top Assignees */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Top Assignees</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={charts.assigneeDistribution} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={150} />
              <Tooltip />
              <Bar dataKey="value" fill="#ffc658" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Lists */}
      <div style={styles.listsGrid}>
        {/* Open Bugs */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Open Bugs ({lists.openBugs.length})</h3>
          <div style={styles.list}>
            {lists.openBugs.slice(0, 10).map((issue) => (
              <div key={issue.issueKey} style={styles.listItem}>
                <span style={styles.issueKey}>{issue.issueKey}</span>
                <span style={styles.issueSummary}>{issue.summary}</span>
                <span style={styles.issuePriority}>{issue.priority}</span>
              </div>
            ))}
            {lists.openBugs.length === 0 && <p style={styles.emptyList}>No open bugs</p>}
          </div>
        </div>

        {/* Unassigned Issues */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Unassigned Issues ({lists.unassignedIssues.length})</h3>
          <div style={styles.list}>
            {lists.unassignedIssues.slice(0, 10).map((issue) => (
              <div key={issue.issueKey} style={styles.listItem}>
                <span style={styles.issueKey}>{issue.issueKey}</span>
                <span style={styles.issueSummary}>{issue.summary}</span>
                <span style={styles.issueType}>{issue.issueType}</span>
              </div>
            ))}
            {lists.unassignedIssues.length === 0 && <p style={styles.emptyList}>All issues assigned</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '20px',
    maxWidth: '1400px',
    margin: '0 auto',
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '18px',
    color: '#666',
  },
  error: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '18px',
    color: '#cc0000',
    backgroundColor: '#ffe7e7',
    borderRadius: '8px',
    margin: '20px',
  },
  processing: {
    textAlign: 'center',
    padding: '60px 20px',
    backgroundColor: '#e7f3ff',
    borderRadius: '8px',
    margin: '20px',
  },
  header: {
    marginBottom: '30px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    marginBottom: '16px',
    color: '#333',
  },
  uploadInfo: {
    display: 'flex',
    gap: '20px',
    fontSize: '14px',
    color: '#666',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  chartsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  listsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))',
    gap: '20px',
  },
  card: {
    backgroundColor: '#fff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '16px',
    color: '#333',
  },
  statRow: {
    display: 'flex',
    gap: '20px',
    justifyContent: 'space-around',
  },
  stat: {
    textAlign: 'center',
  },
  statValue: {
    fontSize: '36px',
    fontWeight: 'bold',
    color: '#0066cc',
    marginBottom: '8px',
  },
  statLabel: {
    fontSize: '14px',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  list: {
    maxHeight: '400px',
    overflowY: 'auto',
  },
  listItem: {
    display: 'flex',
    gap: '12px',
    padding: '12px',
    borderBottom: '1px solid #eee',
    alignItems: 'center',
  },
  issueKey: {
    fontWeight: '600',
    color: '#0066cc',
    minWidth: '100px',
  },
  issueSummary: {
    flex: 1,
    color: '#333',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  issuePriority: {
    padding: '4px 8px',
    backgroundColor: '#ff4444',
    color: '#fff',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '500',
  },
  issueType: {
    padding: '4px 8px',
    backgroundColor: '#666',
    color: '#fff',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '500',
  },
  emptyList: {
    textAlign: 'center',
    padding: '20px',
    color: '#999',
  },
};
