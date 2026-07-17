import React from 'react';
import ReactDOM from 'react-dom/client';
import JiraDashboardApp from './JiraDashboardApp';
import './jira-dashboard.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <JiraDashboardApp />
  </React.StrictMode>
);
