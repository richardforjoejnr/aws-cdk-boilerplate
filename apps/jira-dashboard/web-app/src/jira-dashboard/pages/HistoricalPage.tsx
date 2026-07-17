import React from 'react';
import { useNavigate } from 'react-router-dom';
import { HistoricalDashboard } from '../components/HistoricalDashboard';

export const HistoricalPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={styles.container}>
      <div style={styles.nav}>
        <button onClick={() => navigate('/')} style={styles.backButton}>
          ← Back to Home
        </button>
      </div>
      <HistoricalDashboard />
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
};
