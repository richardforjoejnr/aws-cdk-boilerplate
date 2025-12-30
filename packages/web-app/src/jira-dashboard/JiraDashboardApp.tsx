import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoricalPage } from './pages/HistoricalPage';

export const JiraDashboardApp: React.FC = () => {
  return (
    <Router basename="/jira-dashboard.html">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard/:uploadId" element={<DashboardPage />} />
        <Route path="/historical" element={<HistoricalPage />} />
      </Routes>
    </Router>
  );
};

export default JiraDashboardApp;
