# Jira Metrics Dashboard

A comprehensive, serverless Jira analytics dashboard built on AWS. Upload Jira CSV exports to track metrics, analyze trends, and gain insights into your project's health over time.

## Features

### 📊 Current Dashboard Metrics
- **Bug Tracking**
  - Open bugs by severity and priority
  - Bugs created this month
  - Bugs closed this month
  - Bug status distribution

- **Ticket Metrics**
  - Total tickets created this month
  - Total tickets closed this month
  - Tickets by status (To Do, In Progress, Done, etc.)
  - Tickets by issue type
  - Tickets by priority

- **Team Analytics**
  - Tickets assigned to team members
  - Unassigned tickets
  - Top assignees by workload

- **Visual Charts**
  - Status distribution (Pie chart)
  - Priority distribution (Bar chart)
  - Issue type distribution (Bar chart)
  - Top assignees (Horizontal bar chart)

### 📈 Historical Trends
- Total issues over time (Line chart)
- Bugs created vs closed trends (Line chart)
- Monthly created vs closed comparison (Bar chart)
- Unassigned issues trends (Line chart)
- Status and priority evolution over time
- Aggregate statistics across all uploads

### 💾 Data Storage
- All uploaded CSVs are stored in S3
- Parsed issue data stored in DynamoDB
- Historical data retained for trend analysis
- Supports unlimited uploads for complete historical tracking

## Architecture

### AWS Services Used
- **S3**: CSV file storage
- **DynamoDB**:
  - Upload metadata table
  - Parsed issues table with GSIs for efficient querying
- **Lambda**:
  - CSV processing and parsing
  - API handlers for data retrieval
- **API Gateway**: REST API for frontend communication
- **CloudFront**: Web app CDN distribution (optional)

### Infrastructure
```
┌─────────────┐
│   User      │
└──────┬──────┘
       │
       ├──Upload CSV──────────────►┌──────────┐
       │                           │    S3    │
       │                           └────┬─────┘
       │                                │
       │                          ┌─────▼──────┐
       │                          │  Lambda    │
       │                          │ Processor  │
       │                          └─────┬──────┘
       │                                │
       │                           ┌────▼────┐
       │                           │DynamoDB │
       │                           └────┬────┘
       │                                │
       └──View Dashboard──────────►┌───▼─────┐
                                   │   API   │
                                   │ Gateway │
                                   └─────────┘
```

## Setup and Deployment

### Prerequisites
- AWS Account with appropriate permissions
- AWS CLI configured
- Node.js >= 18.0.0
- npm >= 10.0.0
- AWS CDK installed

### Quick Start

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd AWS
   npm install
   ```

2. **Deploy to Development**
   ```bash
   npm run jira:deploy:dev
   ```

   This script will:
   - Install all dependencies
   - Build Lambda functions
   - Deploy infrastructure (DynamoDB, S3, Lambda, API Gateway)
   - Build the web application
   - Output your API URL

3. **Access Your Dashboard**
   - The deployment script will output your API URL
   - Set up the web app with the API URL
   - Open the dashboard in your browser

### Deployment Commands

```bash
# Deploy to different environments
npm run jira:deploy:dev      # Development
npm run jira:deploy:test     # Testing
npm run jira:deploy:prod     # Production

# Destroy resources
npm run jira:destroy:dev     # Destroy dev environment
npm run jira:destroy:test    # Destroy test environment
npm run jira:destroy:prod    # Destroy prod environment
```

### Manual Deployment

If you prefer manual control:

```bash
# 1. Build Lambda functions
cd packages/functions
npm install
npm run build

# 2. Deploy infrastructure
cd ../infrastructure
npm install
STAGE=dev npx cdk deploy dev-aws-boilerplate-jira-dashboard

# 3. Build web app
cd ../web-app
npm install
VITE_JIRA_API_URL=<your-api-url> npm run build

# 4. Deploy web app (optional)
cd ../infrastructure
DEPLOY_WEBAPP=true STAGE=dev npx cdk deploy dev-aws-boilerplate-web-app
```

## Usage

### 1. Export Jira Data

From your Jira project:
1. Go to Issues → Search for Issues
2. Click "Export" → "Export CSV (all fields)"
3. Save the CSV file

### 2. Upload CSV

1. Navigate to the dashboard home page
2. Click "Choose File" and select your Jira CSV export
3. (Optional) Add a description (e.g., "December 2024 Export")
4. Click "Upload CSV"
5. Wait for processing to complete (large files may take a few minutes)

### 3. View Current Dashboard

Once processing is complete:
- View comprehensive metrics for the uploaded data
- See bug tracking statistics
- Analyze team workload distribution
- Review status and priority breakdowns

### 4. View Historical Trends

After uploading multiple CSVs:
- Navigate to "Historical Trends"
- See how metrics evolve over time
- Compare different time periods
- Identify patterns and trends

## API Endpoints

### POST /uploads
Generate a presigned URL for CSV upload
```json
Request:
{
  "fileName": "jira-export.csv",
  "description": "December 2024"
}

Response:
{
  "uploadId": "uuid",
  "presignedUrl": "https://..."
}
```

### GET /uploads
List all uploads
```json
Response:
{
  "uploads": [...],
  "count": 10
}
```

### GET /dashboard/{uploadId}
Get dashboard data for a specific upload
```json
Response:
{
  "upload": {...},
  "summary": {...},
  "charts": {...},
  "lists": {...}
}
```

### GET /historical
Get historical trend data across all uploads
```json
Response:
{
  "trends": {...},
  "aggregateStats": {...},
  "uploads": [...]
}
```

## Data Model

### Uploads Table
```
PK: uploadId
SK: timestamp
Attributes:
- fileName
- description
- status (pending/processing/completed/failed)
- totalIssues
- metrics (calculated metrics object)
- createdAt
- updatedAt
```

### Issues Table
```
PK: issueKey
SK: uploadId
Attributes:
- All Jira fields from CSV
- summary
- issueType
- status
- priority
- assignee
- created
- updated
- resolved
- projectKey
- projectName
- etc.
```

## Metrics Calculated

The system automatically calculates:

1. **Total Issues**: Count of all issues
2. **By Status**: Distribution across statuses
3. **By Priority**: Distribution across priorities
4. **By Type**: Distribution across issue types
5. **By Assignee**: Workload per team member
6. **Bugs**:
   - Total bugs
   - Open bugs
   - Bugs by priority
7. **This Month**:
   - Issues created
   - Issues closed
   - Bugs created
   - Bugs closed
8. **Unassigned**: Count of unassigned issues

## Cost Considerations

### Development Environment
- DynamoDB: Pay-per-request billing (very low cost)
- S3: Storage cost (minimal for CSV files)
- Lambda: Free tier covers most usage
- API Gateway: Free tier covers most usage
- **Estimated cost**: $1-5 per month

### Production Environment
- DynamoDB: Provisioned capacity with auto-scaling
- Point-in-time recovery enabled
- CloudFront: CDN distribution costs
- **Estimated cost**: $10-50 per month depending on usage

## Environment-Specific Configuration

The system uses different configurations per environment:

### Development (dev)
- DynamoDB: Pay-per-request
- Removal policy: DESTROY
- No deletion protection
- Minimal CloudFront distribution

### Production (prod)
- DynamoDB: Provisioned capacity with auto-scaling
- Removal policy: RETAIN
- Deletion protection enabled
- Point-in-time recovery enabled
- Full CloudFront distribution

## Troubleshooting

### CSV Processing Failed
- Check Lambda logs: `aws logs tail /aws/lambda/dev-jira-csv-processor --follow`
- Ensure CSV is valid Jira export format
- Check for special characters or encoding issues

### Upload Not Appearing
- Check S3 bucket: `aws s3 ls s3://dev-jira-dashboard-csvs`
- Verify Lambda function was triggered
- Check DynamoDB uploads table

### Dashboard Not Loading
- Verify API URL is correct in web app
- Check CORS configuration in API Gateway
- Check browser console for errors

## Development

### Project Structure
```
AWS/
├── packages/
│   ├── functions/
│   │   └── src/
│   │       ├── jira-csv-processor/
│   │       ├── jira-get-upload-url/
│   │       ├── jira-list-uploads/
│   │       ├── jira-get-dashboard-data/
│   │       └── jira-get-historical-data/
│   ├── infrastructure/
│   │   └── lib/
│   │       └── jira-dashboard-stack.ts
│   └── web-app/
│       └── src/
│           └── jira-dashboard/
│               ├── components/
│               ├── pages/
│               ├── services/
│               └── types/
└── scripts/
    ├── deploy-jira-dashboard.sh
    └── destroy-jira-dashboard.sh
```

### Adding New Metrics

1. Update the CSV processor Lambda function
2. Add new calculations to `calculateMetrics()` function
3. Update the `Metrics` type in types
4. Add visualization in dashboard components

### Customizing Charts

Charts are built with Recharts. Customize in:
- `packages/web-app/src/jira-dashboard/components/CurrentDashboard.tsx`
- `packages/web-app/src/jira-dashboard/components/HistoricalDashboard.tsx`

## Security

- S3 buckets have private access only
- API Gateway has CORS configured (restrict origins in production)
- DynamoDB tables use AWS managed encryption
- Lambda functions have minimal IAM permissions
- Presigned URLs expire after 1 hour

## Cleanup

To remove all resources:

```bash
# Development
npm run jira:destroy:dev

# This will:
# 1. Empty S3 bucket
# 2. Delete DynamoDB tables
# 3. Remove Lambda functions
# 4. Delete API Gateway
# 5. Clean up all CloudFormation resources
```

⚠️ **Warning**: This will permanently delete all uploaded CSVs and stored data!

## Future Enhancements

Potential additions:
- User authentication with Cognito
- Real-time Jira integration (no CSV needed)
- Custom metric definitions
- Team-based filtering
- Sprint-specific analytics
- Export dashboard data to PDF
- Email reports
- Slack/Teams notifications
- Custom date range filtering

## Support

For issues or questions:
1. Check CloudFormation stack events
2. Review Lambda function logs
3. Verify DynamoDB table contents
4. Check S3 bucket objects

## License

[Your License Here]

---

Built with ❤️ using AWS CDK, Lambda, DynamoDB, and React
