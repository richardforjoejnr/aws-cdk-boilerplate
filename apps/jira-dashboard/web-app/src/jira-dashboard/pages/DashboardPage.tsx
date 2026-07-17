import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CurrentDashboard } from '../components/CurrentDashboard';

export const DashboardPage: React.FC = () => {
  const { uploadId } = useParams<{ uploadId: string }>();
  const navigate = useNavigate();

  if (!uploadId) {
    return <div style={styles.error}>No upload ID provided</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.nav}>
        <button onClick={() => navigate('/')} style={styles.backButton}>
          ← Back to Home
        </button>
        <button onClick={() => navigate('/historical')} style={styles.navButton}>
          View Historical Trends
        </button>
      </div>
      <CurrentDashboard uploadId={uploadId} />
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f8f9fa',
  },
  nav: {
    backgroundColor: '#fff',
    padding: '16px 20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    display: 'flex',
    gap: '12px',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backButton: {
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
  navButton: {
    padding: '10px 20px',
    backgroundColor: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  error: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '18px',
    color: '#cc0000',
  },
};
