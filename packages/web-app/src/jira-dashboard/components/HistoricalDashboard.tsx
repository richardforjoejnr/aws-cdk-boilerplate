import React, { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { HistoricalData } from '../types';
import jiraApi from '../services/api';
import { format } from 'date-fns';

export const HistoricalDashboard: React.FC = () => {
  const [data, setData] = useState<HistoricalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    void loadHistoricalData();
  }, []);

  const loadHistoricalData = async () => {
    try {
      const historicalData = await jiraApi.getHistoricalData();
      setData(historicalData);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load historical data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading historical data...</div>;
  }

  if (error) {
    return <div style={styles.error}>Error: {error}</div>;
  }

  if (!data || data.uploads.length === 0) {
    return (
      <div style={styles.empty}>
        <h2>No Historical Data</h2>
        <p>Upload at least one CSV file to see historical trends.</p>
      </div>
    );
  }

  const { trends, aggregateStats } = data;

  // Format data for charts
  const formattedTotalIssues = trends.totalIssuesOverTime.map(item => ({
    ...item,
    date: format(new Date(item.date), 'MM/dd/yyyy'),
  }));

  const formattedBugs = trends.bugsOverTime.map(item => ({
    ...item,
    date: format(new Date(item.date), 'MM/dd/yyyy'),
  }));

  const formattedIssuesCreated = trends.issuesCreatedPerMonth.map(item => ({
    ...item,
    date: format(new Date(item.date), 'MM/dd/yyyy'),
  }));

  const formattedUnassigned = trends.unassignedTrends.map(item => ({
    ...item,
    date: format(new Date(item.date), 'MM/dd/yyyy'),
  }));

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Historical Trends</h1>
        <p style={styles.subtitle}>
          Analyzing {aggregateStats.totalUploads} uploads from {format(new Date(aggregateStats.oldestUpload.timestamp), 'PPP')} to {format(new Date(aggregateStats.latestUpload.timestamp), 'PPP')}
        </p>
      </div>

      {/* Summary Cards */}
      <div style={styles.summaryGrid}>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Total Uploads</h3>
          <div style={styles.statValue}>{aggregateStats.totalUploads}</div>
          <div style={styles.statLabel}>CSV Files Analyzed</div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Average Issues</h3>
          <div style={styles.statValue}>{Math.round(aggregateStats.averageIssuesPerUpload)}</div>
          <div style={styles.statLabel}>Per Upload</div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Average Bugs</h3>
          <div style={styles.statValue}>{Math.round(aggregateStats.averageBugsPerUpload)}</div>
          <div style={styles.statLabel}>Per Upload</div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Latest Upload</h3>
          <div style={styles.statValue}>{aggregateStats.latestUpload.totalIssues}</div>
          <div style={styles.statLabel}>Issues</div>
        </div>
      </div>

      {/* Charts */}
      <div style={styles.chartsGrid}>
        {/* Total Issues Over Time */}
        <div style={styles.cardLarge}>
          <h3 style={styles.cardTitle}>Total Issues Over Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={formattedTotalIssues}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" angle={-45} textAnchor="end" height={80} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="totalIssues" stroke="#8884d8" strokeWidth={2} name="Total Issues" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Bugs Over Time */}
        <div style={styles.cardLarge}>
          <h3 style={styles.cardTitle}>Bugs Over Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={formattedBugs}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" angle={-45} textAnchor="end" height={80} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="totalBugs" stroke="#ff8042" strokeWidth={2} name="Total Bugs" />
              <Line type="monotone" dataKey="openBugs" stroke="#ff4444" strokeWidth={2} name="Open Bugs" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Issues Created vs Closed */}
        <div style={styles.cardLarge}>
          <h3 style={styles.cardTitle}>Monthly Created vs Closed</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={formattedIssuesCreated}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" angle={-45} textAnchor="end" height={80} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="created" fill="#00C49F" name="Created" />
              <Bar dataKey="closed" fill="#0088FE" name="Closed" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Unassigned Issues Trend */}
        <div style={styles.cardLarge}>
          <h3 style={styles.cardTitle}>Unassigned Issues Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={formattedUnassigned}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" angle={-45} textAnchor="end" height={80} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="unassigned" stroke="#ff8800" strokeWidth={2} name="Unassigned" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Upload History Table */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Upload History</h3>
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>File Name</th>
                <th style={styles.th}>Total Issues</th>
              </tr>
            </thead>
            <tbody>
              {data.uploads.reverse().map((upload) => (
                <tr key={upload.uploadId}>
                  <td style={styles.td}>{format(new Date(upload.timestamp), 'PPP')}</td>
                  <td style={styles.td}>{upload.fileName}</td>
                  <td style={styles.td}>{upload.totalIssues}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
  empty: {
    textAlign: 'center',
    padding: '60px 20px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    margin: '20px',
  },
  header: {
    marginBottom: '30px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    marginBottom: '8px',
    color: '#333',
  },
  subtitle: {
    fontSize: '16px',
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(600px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  card: {
    backgroundColor: '#fff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  cardLarge: {
    backgroundColor: '#fff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    gridColumn: 'span 1',
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '16px',
    color: '#333',
  },
  statValue: {
    fontSize: '48px',
    fontWeight: 'bold',
    color: '#0066cc',
    marginBottom: '8px',
    textAlign: 'center',
  },
  statLabel: {
    fontSize: '14px',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    textAlign: 'center',
  },
  tableContainer: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    textAlign: 'left',
    padding: '12px',
    backgroundColor: '#f8f9fa',
    fontWeight: '600',
    borderBottom: '2px solid #dee2e6',
  },
  td: {
    padding: '12px',
    borderBottom: '1px solid #dee2e6',
  },
};
