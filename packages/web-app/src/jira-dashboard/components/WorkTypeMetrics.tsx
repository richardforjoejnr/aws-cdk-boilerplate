import React from 'react';
import { Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Legend } from 'recharts';
import { Metrics } from '../types';

interface WorkTypeMetricsProps {
  metrics: Metrics;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7c7c'];

export const WorkTypeMetrics: React.FC<WorkTypeMetricsProps> = ({ metrics }) => {
  return (
    <div style={styles.container}>
      <h2 style={styles.sectionTitle}>Value Delivery Metrics by Work Type</h2>

      {/* Epics - Strategic Value */}
      {metrics.epics && (
        <div style={styles.section}>
          <h3 style={styles.workTypeTitle}>Epics (Strategic Value)</h3>
          <div style={styles.metricsGrid}>
            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Epic Status</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#00C49F' }}>{metrics.epics.completed}</div>
                  <div style={styles.statLabel}>Completed</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#0088FE' }}>{metrics.epics.inProgress}</div>
                  <div style={styles.statLabel}>In Progress</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#FF8042' }}>{metrics.epics.blocked}</div>
                  <div style={styles.statLabel}>Blocked</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Epic Performance</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={styles.statValue}>{metrics.epics.completionRate}%</div>
                  <div style={styles.statLabel}>Completion Rate</div>
                </div>
                <div style={styles.stat}>
                  <div style={styles.statValue}>{metrics.epics.avgCycleTime}</div>
                  <div style={styles.statLabel}>Avg Cycle Time (days)</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Epic Health</h4>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'On Track', value: metrics.epics.health.onTrack },
                      { name: 'At Risk', value: metrics.epics.health.atRisk },
                      { name: 'Delayed', value: metrics.epics.health.delayed },
                    ]}
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    fill="#8884d8"
                    dataKey="value"
                    label
                  >
                    <Cell fill="#00C49F" />
                    <Cell fill="#FFBB28" />
                    <Cell fill="#FF8042" />
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Stories - Feature Value */}
      {metrics.stories && (
        <div style={styles.section}>
          <h3 style={styles.workTypeTitle}>Stories (Feature Value)</h3>
          <div style={styles.metricsGrid}>
            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Story Delivery</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#00C49F' }}>{metrics.stories.completed}</div>
                  <div style={styles.statLabel}>Completed</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#0088FE' }}>{metrics.stories.storyPointsDelivered}</div>
                  <div style={styles.statLabel}>Story Points</div>
                </div>
                <div style={styles.stat}>
                  <div style={styles.statValue}>{metrics.stories.inProgress}</div>
                  <div style={styles.statLabel}>In Progress</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Story Metrics</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={styles.statValue}>{metrics.stories.throughput}</div>
                  <div style={styles.statLabel}>Throughput/Week</div>
                </div>
                <div style={styles.stat}>
                  <div style={styles.statValue}>{metrics.stories.avgCycleTime}</div>
                  <div style={styles.statLabel}>Avg Cycle Time (days)</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Stories by Status</h4>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={[
                    { name: 'To Do', value: metrics.stories.byStatus.toDo },
                    { name: 'In Progress', value: metrics.stories.byStatus.inProgress },
                    { name: 'Done', value: metrics.stories.byStatus.done },
                    { name: 'Blocked', value: metrics.stories.byStatus.blocked },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8884d8">
                    <Cell fill="#CCCCCC" />
                    <Cell fill="#0088FE" />
                    <Cell fill="#00C49F" />
                    <Cell fill="#FF8042" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Tasks - Execution Value */}
      {metrics.tasks && (
        <div style={styles.section}>
          <h3 style={styles.workTypeTitle}>Tasks (Execution Value)</h3>
          <div style={styles.metricsGrid}>
            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Task Status</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#00C49F' }}>{metrics.tasks.completed}</div>
                  <div style={styles.statLabel}>Completed</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#0088FE' }}>{metrics.tasks.inProgress}</div>
                  <div style={styles.statLabel}>In Progress</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#FF8042' }}>{metrics.tasks.overdue}</div>
                  <div style={styles.statLabel}>Overdue</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Task Performance</h4>
              <div style={styles.stat}>
                <div style={styles.statValue}>{metrics.tasks.completionRate}%</div>
                <div style={styles.statLabel}>Completion Rate</div>
              </div>
            </div>

            {Object.keys(metrics.tasks.distributionByParent).length > 0 && (
              <div style={styles.card}>
                <h4 style={styles.cardTitle}>Top Parent Issues</h4>
                <div style={styles.miniList}>
                  {Object.entries(metrics.tasks.distributionByParent)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 5)
                    .map(([parent, count]) => (
                      <div key={parent} style={styles.miniListItem}>
                        <span>{parent}</span>
                        <span style={styles.badge}>{count}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bugs - Quality Metrics */}
      {metrics.bugMetrics && (
        <div style={styles.section}>
          <h3 style={styles.workTypeTitle}>Bugs (Quality Metrics)</h3>
          <div style={styles.metricsGrid}>
            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Open Bugs by Severity</h4>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={[
                    { name: 'Critical', value: metrics.bugMetrics.openBySeverity.critical },
                    { name: 'High', value: metrics.bugMetrics.openBySeverity.high },
                    { name: 'Medium', value: metrics.bugMetrics.openBySeverity.medium },
                    { name: 'Low', value: metrics.bugMetrics.openBySeverity.low },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8884d8">
                    <Cell fill="#FF0000" />
                    <Cell fill="#FF8042" />
                    <Cell fill="#FFBB28" />
                    <Cell fill="#00C49F" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Bug Trend</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#FF8042' }}>{metrics.bugMetrics.createdVsClosed.created}</div>
                  <div style={styles.statLabel}>Created</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#00C49F' }}>{metrics.bugMetrics.createdVsClosed.closed}</div>
                  <div style={styles.statLabel}>Closed</div>
                </div>
                <div style={styles.stat}>
                  <div style={{
                    ...styles.statValue,
                    color: metrics.bugMetrics.createdVsClosed.trend === 'improving' ? '#00C49F' :
                           metrics.bugMetrics.createdVsClosed.trend === 'degrading' ? '#FF8042' : '#FFBB28'
                  }}>
                    {metrics.bugMetrics.createdVsClosed.trend}
                  </div>
                  <div style={styles.statLabel}>Trend</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Bug Metrics</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={styles.statValue}>{metrics.bugMetrics.avgAge}</div>
                  <div style={styles.statLabel}>Avg Age (days)</div>
                </div>
                <div style={styles.stat}>
                  <div style={styles.statValue}>{metrics.bugMetrics.avgResolutionTime}</div>
                  <div style={styles.statLabel}>Avg Resolution (days)</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#FF8042' }}>{metrics.bugMetrics.escapedDefects}</div>
                  <div style={styles.statLabel}>Escaped to Prod</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Spikes - Research & Risk Reduction */}
      {metrics.spikes && (metrics.spikes.inFlight > 0 || metrics.spikes.completed > 0 || metrics.spikes.pending > 0) && (
        <div style={styles.section}>
          <h3 style={styles.workTypeTitle}>Spikes (Research & Risk Reduction)</h3>
          <div style={styles.metricsGrid}>
            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Spike Status</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#0088FE' }}>{metrics.spikes.inFlight}</div>
                  <div style={styles.statLabel}>In Flight</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#00C49F' }}>{metrics.spikes.completed}</div>
                  <div style={styles.statLabel}>Completed</div>
                </div>
                <div style={styles.stat}>
                  <div style={styles.statValue}>{metrics.spikes.pending}</div>
                  <div style={styles.statLabel}>Pending</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Spike Metrics</h4>
              <div style={styles.stat}>
                <div style={styles.statValue}>{metrics.spikes.avgDuration}</div>
                <div style={styles.statLabel}>Avg Duration (days)</div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Spike Outcomes</h4>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Led to Story', value: metrics.spikes.outcomes.ledToStory },
                      { name: 'No Action', value: metrics.spikes.outcomes.noAction },
                      { name: 'Blocked', value: metrics.spikes.outcomes.blocked },
                    ]}
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    fill="#8884d8"
                    dataKey="value"
                    label
                  >
                    {COLORS.map((color, index) => (
                      <Cell key={`cell-${index}`} fill={color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Risks - Risk Management */}
      {metrics.risks && (metrics.risks.new > 0 || metrics.risks.active > 0 || metrics.risks.mitigated > 0) && (
        <div style={styles.section}>
          <h3 style={styles.workTypeTitle}>Risks (Risk Management)</h3>
          <div style={styles.metricsGrid}>
            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Risk Status</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#FF8042' }}>{metrics.risks.new}</div>
                  <div style={styles.statLabel}>New</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#FFBB28' }}>{metrics.risks.active}</div>
                  <div style={styles.statLabel}>Active</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#00C49F' }}>{metrics.risks.mitigated}</div>
                  <div style={styles.statLabel}>Mitigated</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Risk Metrics</h4>
              <div style={styles.stat}>
                <div style={styles.statValue}>{metrics.risks.avgAge}</div>
                <div style={styles.statLabel}>Avg Age (days)</div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Risks by Severity</h4>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={[
                    { name: 'High', value: metrics.risks.bySeverity.high },
                    { name: 'Medium', value: metrics.risks.bySeverity.medium },
                    { name: 'Low', value: metrics.risks.bySeverity.low },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8884d8">
                    <Cell fill="#FF0000" />
                    <Cell fill="#FFBB28" />
                    <Cell fill="#00C49F" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ADRs - Technical Governance */}
      {metrics.adrs && (metrics.adrs.approved > 0 || metrics.adrs.pendingReview > 0 || metrics.adrs.inProgress > 0) && (
        <div style={styles.section}>
          <h3 style={styles.workTypeTitle}>ADRs (Technical Governance)</h3>
          <div style={styles.metricsGrid}>
            <div style={styles.card}>
              <h4 style={styles.cardTitle}>ADR Status</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#00C49F' }}>{metrics.adrs.approved}</div>
                  <div style={styles.statLabel}>Approved</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#FFBB28' }}>{metrics.adrs.pendingReview}</div>
                  <div style={styles.statLabel}>Pending Review</div>
                </div>
                <div style={styles.stat}>
                  <div style={styles.statValue}>{metrics.adrs.inProgress}</div>
                  <div style={styles.statLabel}>In Progress</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Decision Velocity</h4>
              <div style={styles.stat}>
                <div style={styles.statValue}>{metrics.adrs.avgDecisionVelocity}</div>
                <div style={styles.statLabel}>Avg Days to Approval</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Escalated Defects - Critical Issues */}
      {metrics.escalatedDefects && metrics.escalatedDefects.active > 0 && (
        <div style={styles.section}>
          <h3 style={styles.workTypeTitle}>Escalated Defects (Critical Issues)</h3>
          <div style={styles.metricsGrid}>
            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Active Escalations</h4>
              <div style={styles.stat}>
                <div style={{ ...styles.statValue, color: '#FF0000' }}>{metrics.escalatedDefects.active}</div>
                <div style={styles.statLabel}>Active</div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Escalation Metrics</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={styles.statValue}>{metrics.escalatedDefects.avgAge}</div>
                  <div style={styles.statLabel}>Avg Age (hours)</div>
                </div>
                <div style={styles.stat}>
                  <div style={styles.statValue}>{metrics.escalatedDefects.avgResolutionTime}</div>
                  <div style={styles.statLabel}>Avg Resolution (hours)</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>By Severity</h4>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={[
                    { name: 'P0', value: metrics.escalatedDefects.bySeverity.p0 },
                    { name: 'P1', value: metrics.escalatedDefects.bySeverity.p1 },
                    { name: 'P2', value: metrics.escalatedDefects.bySeverity.p2 },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8884d8">
                    <Cell fill="#FF0000" />
                    <Cell fill="#FF8042" />
                    <Cell fill="#FFBB28" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Initiatives - Business Outcomes */}
      {metrics.initiatives && (metrics.initiatives.delivered > 0 || metrics.initiatives.atRisk > 0) && (
        <div style={styles.section}>
          <h3 style={styles.workTypeTitle}>Initiatives (Business Outcomes)</h3>
          <div style={styles.metricsGrid}>
            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Initiative Status</h4>
              <div style={styles.statRow}>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#00C49F' }}>{metrics.initiatives.delivered}</div>
                  <div style={styles.statLabel}>Delivered</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statValue, color: '#FF8042' }}>{metrics.initiatives.atRisk}</div>
                  <div style={styles.statLabel}>At Risk</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Initiative Progress</h4>
              <div style={styles.stat}>
                <div style={styles.statValue}>{metrics.initiatives.avgProgress}%</div>
                <div style={styles.statLabel}>Avg Progress</div>
              </div>
            </div>

            <div style={styles.card}>
              <h4 style={styles.cardTitle}>Dependency Health</h4>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'On Track', value: metrics.initiatives.dependencyHealth.onTrack },
                      { name: 'Blocked', value: metrics.initiatives.dependencyHealth.blocked },
                    ]}
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    fill="#8884d8"
                    dataKey="value"
                    label
                  >
                    <Cell fill="#00C49F" />
                    <Cell fill="#FF8042" />
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '20px 0',
  },
  sectionTitle: {
    fontSize: '28px',
    fontWeight: 'bold',
    marginBottom: '30px',
    color: '#333',
    borderBottom: '3px solid #0066cc',
    paddingBottom: '10px',
  },
  section: {
    marginBottom: '40px',
  },
  workTypeTitle: {
    fontSize: '22px',
    fontWeight: '600',
    marginBottom: '20px',
    color: '#0066cc',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
    marginBottom: '20px',
  },
  card: {
    backgroundColor: '#fff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: '600',
    marginBottom: '16px',
    color: '#333',
  },
  statRow: {
    display: 'flex',
    gap: '20px',
    justifyContent: 'space-around',
    flexWrap: 'wrap',
  },
  stat: {
    textAlign: 'center',
    flex: 1,
    minWidth: '80px',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#0066cc',
    marginBottom: '8px',
  },
  statLabel: {
    fontSize: '12px',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  miniList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  miniListItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
    fontSize: '14px',
  },
  badge: {
    backgroundColor: '#0066cc',
    color: '#fff',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
  },
};
