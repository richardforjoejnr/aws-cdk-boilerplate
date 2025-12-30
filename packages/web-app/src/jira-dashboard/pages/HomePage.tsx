import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUpload } from '../components/FileUpload';
import { Upload } from '../types';
import jiraApi from '../services/api';
import { format } from 'date-fns';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUploads();
  }, []);

  // Auto-refresh uploads list when there are processing uploads
  useEffect(() => {
    const hasProcessingUploads = uploads.some(
      (upload) => upload.status === 'processing' || upload.status === 'pending'
    );

    if (!hasProcessingUploads) {
      return;
    }

    // Poll every 2 seconds
    const interval = setInterval(() => {
      loadUploads();
    }, 2000);

    return () => clearInterval(interval);
  }, [uploads]);

  const loadUploads = async () => {
    try {
      const data = await jiraApi.listUploads();
      setUploads(data.uploads);
    } catch (error) {
      console.error('Error loading uploads:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadComplete = (uploadId: string) => {
    loadUploads();
    // Navigate to the dashboard after a short delay
    setTimeout(() => {
      navigate(`/dashboard/${uploadId}`);
    }, 3000);
  };

  const handleViewDashboard = (uploadId: string) => {
    navigate(`/dashboard/${uploadId}`);
  };

  const handleViewHistorical = () => {
    navigate('/historical');
  };

  const handleDeleteUpload = async (uploadId: string, fileName: string) => {
    if (!window.confirm(`Are you sure you want to delete "${fileName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await jiraApi.deleteUpload(uploadId);
      // Reload the uploads list
      loadUploads();
    } catch (error) {
      console.error('Error deleting upload:', error);
      alert('Failed to delete upload. Please try again.');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Jira Metrics Dashboard</h1>
        <p style={styles.subtitle}>
          Upload Jira CSV exports to analyze metrics, track trends, and gain insights into your project's health.
        </p>
      </div>

      <div style={styles.mainContent}>
        <div style={styles.leftColumn}>
          <FileUpload onUploadComplete={handleUploadComplete} />
        </div>

        <div style={styles.rightColumn}>
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <h2 style={styles.cardTitle}>Recent Uploads</h2>
              {uploads.length > 1 && (
                <button onClick={handleViewHistorical} style={styles.historicalButton}>
                  View Historical Trends
                </button>
              )}
            </div>

            {loading ? (
              <p style={styles.loadingText}>Loading uploads...</p>
            ) : uploads.length === 0 ? (
              <p style={styles.emptyText}>No uploads yet. Upload your first CSV to get started!</p>
            ) : (
              <div style={styles.uploadsList}>
                {uploads.map((upload) => (
                  <div key={upload.uploadId} style={styles.uploadItem}>
                    <div style={styles.uploadInfo}>
                      <div style={styles.uploadFileName}>{upload.fileName}</div>
                      <div style={styles.uploadMeta}>
                        {format(new Date(upload.createdAt), 'PPp')}
                        {upload.description && ` • ${upload.description}`}
                      </div>
                      <div style={styles.uploadStats}>
                        <span style={getStatusStyle(upload.status)}>{upload.status.toUpperCase()}</span>
                        {upload.status === 'processing' && upload.processedIssues !== undefined && upload.totalIssues ? (
                          <span style={styles.progressText}>
                            {upload.processedIssues}/{upload.totalIssues} issues ({Math.round((upload.processedIssues / upload.totalIssues) * 100)}%)
                          </span>
                        ) : upload.totalIssues ? (
                          <span style={styles.issueCount}>{upload.totalIssues} issues</span>
                        ) : null}
                      </div>
                    </div>
                    <div style={styles.uploadActions}>
                      {upload.status === 'completed' && (
                        <button
                          onClick={() => handleViewDashboard(upload.uploadId)}
                          style={styles.viewButton}
                        >
                          View Dashboard
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteUpload(upload.uploadId, upload.fileName)}
                        style={styles.deleteButton}
                        title={`Delete ${upload.fileName}`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={styles.infoCard}>
            <h3 style={styles.infoTitle}>Available Metrics</h3>
            <ul style={styles.metricsList}>
              <li>Open bugs by severity and priority</li>
              <li>Bugs created and closed this month</li>
              <li>Tickets created and closed this month</li>
              <li>Tickets in sprint, in progress, done</li>
              <li>Tickets assigned to teams</li>
              <li>Unassigned tickets</li>
              <li>Historical trends over time</li>
              <li>Status, priority, and type distributions</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

const getStatusStyle = (status: string): React.CSSProperties => {
  const baseStyle: React.CSSProperties = {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600',
    marginRight: '8px',
  };

  switch (status) {
    case 'completed':
      return { ...baseStyle, backgroundColor: '#d4edda', color: '#155724' };
    case 'processing':
      return { ...baseStyle, backgroundColor: '#fff3cd', color: '#856404' };
    case 'failed':
      return { ...baseStyle, backgroundColor: '#f8d7da', color: '#721c24' };
    default:
      return { ...baseStyle, backgroundColor: '#d1ecf1', color: '#0c5460' };
  }
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f8f9fa',
    padding: '20px',
  },
  header: {
    maxWidth: '1400px',
    margin: '0 auto 40px',
    textAlign: 'center',
  },
  title: {
    fontSize: '48px',
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: '12px',
  },
  subtitle: {
    fontSize: '18px',
    color: '#666',
    maxWidth: '800px',
    margin: '0 auto',
  },
  mainContent: {
    maxWidth: '1400px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'minmax(400px, 600px) 1fr',
    gap: '30px',
  },
  leftColumn: {
    display: 'flex',
    flexDirection: 'column',
  },
  rightColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  cardTitle: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#333',
    margin: 0,
  },
  historicalButton: {
    padding: '10px 20px',
    backgroundColor: '#6c757d',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  loadingText: {
    textAlign: 'center',
    color: '#999',
    padding: '40px',
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    padding: '40px',
    fontSize: '16px',
  },
  uploadsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  uploadItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    transition: 'background-color 0.2s',
  },
  uploadInfo: {
    flex: 1,
  },
  uploadFileName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '4px',
  },
  uploadMeta: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '8px',
  },
  uploadStats: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  issueCount: {
    fontSize: '13px',
    color: '#666',
  },
  progressText: {
    fontSize: '13px',
    color: '#856404',
    fontWeight: '600',
  },
  uploadActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  viewButton: {
    padding: '8px 16px',
    backgroundColor: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  deleteButton: {
    padding: '8px 16px',
    backgroundColor: '#dc3545',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  infoTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '16px',
  },
  metricsList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    color: '#666',
    lineHeight: '2',
  },
};
