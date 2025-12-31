import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoricalPage } from './pages/HistoricalPage';
import { CostFooter } from './components/CostFooter';

export const JiraDashboardApp: React.FC = () => {
  return (
    <Router basename="/jira-dashboard.html">
      <div style={{ paddingBottom: '60px' }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard/:uploadId" element={<DashboardPage />} />
          <Route path="/historical" element={<HistoricalPage />} />
        </Routes>
        <CostFooter />
      </div>
    </Router>
  );
};

export default JiraDashboardApp;
