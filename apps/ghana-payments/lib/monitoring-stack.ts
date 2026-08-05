import * as cdk from 'aws-cdk-lib';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  stage: string;
  /** Optional email to receive alarm notifications (ALARM_EMAIL env). */
  alarmEmail?: string;
}

/**
 * Ops dashboard + alarms for Ghana Payments. Reads the EMF custom metrics emitted
 * by the handlers (namespace GhanaPayments/<stage>) plus AWS/ApiGateway, AWS/Lambda
 * and AWS/SQS. Referenced by name (stage-prefixed) so it stays decoupled from the
 * API stack. Design: docs/planning/OBSERVABILITY.md
 */
export class GhanaPaymentsMonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { stage, alarmEmail } = props;
    const ns = `GhanaPayments/${stage}`;
    const apiName = `${stage}-ghana-payments-api`;

    const custom = (metricName: string, stat: string, label?: string): cw.Metric =>
      new cw.Metric({ namespace: ns, metricName, statistic: stat, period: cdk.Duration.minutes(5), label });
    const dlqDepth = (queue: string): cw.Metric =>
      new cw.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesVisible',
        dimensionsMap: { QueueName: queue },
        statistic: 'Maximum',
        period: cdk.Duration.minutes(5),
        label: queue,
      });

    // ── Alarms → SNS ─────────────────────────────────────────────────────────
    const topic = new sns.Topic(this, 'AlarmTopic', { topicName: `${stage}-ghana-alarms` });
    if (alarmEmail) topic.addSubscription(new subscriptions.EmailSubscription(alarmEmail));
    const alarmAction = new cwActions.SnsAction(topic);

    const dlqs = [
      `${stage}-ghana-mock-callbacks-dlq`,
      `${stage}-ghana-announcer-dlq`,
      `${stage}-ghana-credit-back-dlq`,
      `${stage}-ghana-audit-dlq`,
    ];
    for (const q of dlqs) {
      const alarm = new cw.Alarm(this, `Dlq-${q}`, {
        alarmName: `${q}-not-empty`,
        alarmDescription: `Messages stuck in ${q} — a consumer is failing`,
        metric: dlqDepth(q),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(alarmAction);
    }

    // Payment failure spike (>10 failures in 5 min).
    const failureAlarm = new cw.Alarm(this, 'PaymentFailureSpike', {
      alarmName: `${stage}-ghana-payment-failures`,
      alarmDescription: 'Elevated payment failures',
      metric: custom('PaymentFailureCount', 'Sum'),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    failureAlarm.addAlarmAction(alarmAction);

    // Unhandled errors.
    const errorAlarm = new cw.Alarm(this, 'ErrorSpike', {
      alarmName: `${stage}-ghana-errors`,
      alarmDescription: 'Unhandled 500 errors',
      metric: custom('ErrorCount', 'Sum'),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    errorAlarm.addAlarmAction(alarmAction);

    // ── Dashboard ────────────────────────────────────────────────────────────
    const dash = new cw.Dashboard(this, 'Dashboard', {
      dashboardName: `${stage}-ghana-payments`,
      defaultInterval: cdk.Duration.days(1),
    });
    dash.addWidgets(
      new cw.GraphWidget({
        title: 'Transactions',
        left: [custom('TransactionCount', 'Sum', 'transactions')],
        right: [custom('PaymentFailureCount', 'Sum', 'failures')],
        width: 12,
      }),
      new cw.GraphWidget({
        title: 'Volume (pesewas)',
        left: [custom('TransactionAmountPesewas', 'Sum', 'volume')],
        width: 12,
      })
    );
    dash.addWidgets(
      new cw.GraphWidget({
        title: 'Payment latency (initiated → confirmed)',
        left: [custom('PaymentLatencyMs', 'Average', 'avg'), custom('PaymentLatencyMs', 'p90', 'p90')],
        width: 12,
      }),
      new cw.GraphWidget({
        title: 'Announce latency (confirmed → device)',
        left: [custom('AnnounceLatencyMs', 'Average', 'avg'), custom('AnnounceLatencyMs', 'p90', 'p90')],
        width: 12,
      })
    );
    dash.addWidgets(
      new cw.GraphWidget({
        title: 'API Gateway',
        left: [
          new cw.Metric({ namespace: 'AWS/ApiGateway', metricName: 'Count', dimensionsMap: { ApiName: apiName }, statistic: 'Sum', label: 'requests' }),
          new cw.Metric({ namespace: 'AWS/ApiGateway', metricName: '5XXError', dimensionsMap: { ApiName: apiName }, statistic: 'Sum', label: '5xx' }),
          new cw.Metric({ namespace: 'AWS/ApiGateway', metricName: '4XXError', dimensionsMap: { ApiName: apiName }, statistic: 'Sum', label: '4xx' }),
        ],
        right: [new cw.Metric({ namespace: 'AWS/ApiGateway', metricName: 'Latency', dimensionsMap: { ApiName: apiName }, statistic: 'p90', label: 'latency p90' })],
        width: 12,
      }),
      new cw.GraphWidget({
        title: 'Lambda errors (all ghana functions)',
        left: [new cw.MathExpression({ expression: `SEARCH('{AWS/Lambda,FunctionName} ${stage}-ghana-', 'Sum')`, label: '', usingMetrics: {} })],
        width: 12,
      })
    );
    dash.addWidgets(
      new cw.GraphWidget({
        title: 'Dead-letter queue depth',
        left: dlqs.map(dlqDepth),
        width: 24,
      })
    );

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${stage}-ghana-payments`,
    });
  }
}
