import React, { useEffect, useState } from 'react';

interface CostData {
  currentMonth: {
    total: number;
    breakdown: Array<{ service: string; cost: number }>;
  };
  lastMonth: {
    total: number;
  };
  last7Days: {
    total: number;
    daily: Array<{ date: string; cost: number }>;
  };
}

const API_URL = (import.meta.env.VITE_JIRA_API_URL as string | undefined) || '';

export const CostFooter: React.FC = () => {
  const [costData, setCostData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    void loadCosts();
  }, []);

  const loadCosts = async () => {
    try {
      const response = await fetch(`${API_URL}/costs`);
      if (!response.ok) {
        throw new Error('Failed to fetch cost data');
      }
      const data = (await response.json()) as CostData;
      setCostData(data);
      setError('');
    } catch (err) {
      console.error('Error loading costs:', err);
      setError(err instanceof Error ? err.message : 'Failed to load costs');
    } finally {
      setLoading(false);
    }
  };

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cost);
  };

  if (loading) {
    return (
      <div style={styles.footer}>
        <span style={styles.loadingText}>Loading cost data...</span>
      </div>
    );
  }

  if (error || !costData) {
    return (
      <div style={styles.footer}>
        <span style={styles.errorText}>Unable to load cost data</span>
      </div>
    );
  }

  return (
    <div style={styles.footer}>
      <div style={styles.container}>
        <div style={styles.costItem}>
          <span style={styles.label}>This Month:</span>
          <span style={styles.value}>{formatCost(costData.currentMonth.total)}</span>
        </div>
        <div style={styles.costItem}>
          <span style={styles.label}>Last 7 Days:</span>
          <span style={styles.value}>{formatCost(costData.last7Days.total)}</span>
        </div>
        <div style={styles.costItem}>
          <span style={styles.label}>Last Month:</span>
          <span style={styles.value}>{formatCost(costData.lastMonth.total)}</span>
        </div>
        {costData.currentMonth.breakdown.length > 0 && (
          <div style={styles.topServices}>
            <span style={styles.label}>Top Services:</span>
            <span style={styles.servicesText}>
              {costData.currentMonth.breakdown
                .slice(0, 3)
                .map((s) => `${s.service} (${formatCost(s.cost)})`)
                .join(', ')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  footer: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#2c3e50',
    color: '#ecf0f1',
    padding: '12px 20px',
    borderTop: '2px solid #34495e',
    boxShadow: '0 -2px 10px rgba(0,0,0,0.1)',
    zIndex: 1000,
  },
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '30px',
    maxWidth: '1400px',
    margin: '0 auto',
    flexWrap: 'wrap',
  },
  costItem: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  label: {
    fontSize: '13px',
    color: '#bdc3c7',
    fontWeight: '500',
  },
  value: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#3498db',
  },
  topServices: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flex: 1,
  },
  servicesText: {
    fontSize: '12px',
    color: '#95a5a6',
  },
  loadingText: {
    fontSize: '13px',
    color: '#95a5a6',
  },
  errorText: {
    fontSize: '13px',
    color: '#e74c3c',
  },
};
