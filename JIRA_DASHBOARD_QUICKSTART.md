# Jira Dashboard - Quick Start Guide

Get your Jira Metrics Dashboard up and running in 5 minutes!

## Step 1: Deploy the Infrastructure

```bash
# Deploy to development environment
npm run jira:deploy:dev
```

This single command will:
- ✅ Install all dependencies
- ✅ Build Lambda functions
- ✅ Deploy DynamoDB tables
- ✅ Deploy S3 bucket for CSV storage
- ✅ Deploy API Gateway
- ✅ Deploy Lambda functions
- ✅ Output your API URL

**Expected output:**
```
===============================================
Deployment Complete!
===============================================

API URL: https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/
```

## Step 2: Configure the Web App

Create an environment file with your API URL:

```bash
cd packages/web-app
echo "VITE_JIRA_API_URL=https://your-api-url.amazonaws.com/dev/" > .env.local
```

## Step 3: Run the Web App Locally

```bash
# From packages/web-app directory
npm run dev
```

Open http://localhost:5173 in your browser.

## Step 4: Upload Your First Jira Export

1. **Export from Jira:**
   - Go to your Jira project
   - Navigate to Issues → Search
   - Click "Export" → "Export CSV (all fields)"
   - Save the file

2. **Upload to Dashboard:**
   - Click "Choose File" in the dashboard
   - Select your CSV file
   - (Optional) Add a description like "December 2024"
   - Click "Upload CSV"
   - Wait 30 seconds to a few minutes (depending on file size)

3. **View Your Metrics:**
   - Click "View Dashboard" once processing is complete
   - Explore bug metrics, team workload, status distributions, and more!

## Step 5: Upload More Data for Historical Trends

- Upload CSV exports from different time periods
- Click "View Historical Trends" to see how metrics evolve over time
- Compare bug trends, workload changes, and more across uploads

## Available Metrics

### Current Dashboard
- 📊 Total issues and bugs
- 🐛 Open bugs by priority
- 📈 Issues created/closed this month
- 👥 Team workload distribution
- 📉 Status and priority breakdowns
- 📋 Lists of open bugs and unassigned issues

### Historical Trends
- 📊 Total issues over time
- 🐛 Bug trends (created vs closed)
- 📈 Monthly activity trends
- 👥 Unassigned issues over time
- 📉 Status and priority evolution

## Cleanup (When Done)

To remove all resources and data:

```bash
npm run jira:destroy:dev
```

⚠️ **Warning:** This permanently deletes all uploaded CSVs and data!

## Troubleshooting

### Upload fails
- Check the CSV is a valid Jira export
- View Lambda logs: `aws logs tail /aws/lambda/dev-jira-csv-processor --follow`

### Dashboard doesn't load
- Verify API URL in `.env.local`
- Check browser console for errors
- Ensure CORS is configured correctly

### Processing takes too long
- Large files (10k+ issues) can take 5-10 minutes
- Check Lambda function timeout (currently 15 minutes)
- Monitor via CloudWatch logs

## What's Next?

- Deploy to test/prod: `npm run jira:deploy:prod`
- Deploy web app to CloudFront: `./scripts/deploy-jira-dashboard.sh dev --deploy-webapp`
- Customize metrics in Lambda functions
- Add authentication with Cognito
- Set up automated exports with Jira API

## Support

See [JIRA_DASHBOARD_README.md](./JIRA_DASHBOARD_README.md) for complete documentation.

---

Happy analyzing! 📊
