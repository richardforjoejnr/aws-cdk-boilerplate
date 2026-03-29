# Audit Command

Perform a comprehensive security, cost, and infrastructure audit of this AWS serverless boilerplate project.

## Audit Scope

Analyze the following areas and provide a detailed report:

### 1. Security Audit

**AWS Resources:**
- Review IAM roles and policies for least privilege principle
- Check for overly permissive IAM policies in CDK stacks
- Verify encryption settings (DynamoDB, S3, CloudWatch Logs)
- Check for public S3 buckets or CloudFront misconfigurations
- Review API Gateway and AppSync authentication/authorization
- Verify deletion protection on production resources
- Check for exposed secrets or credentials in code

**Code Security:**
- Scan for hardcoded credentials, API keys, or secrets
- Review environment variable usage and .env file handling
- Check for proper input validation in Lambda functions
- Review VTL templates for injection vulnerabilities
- Verify CORS configuration in API Gateway
- Check Lambda function permissions and execution roles

**GitHub Actions:**
- Review workflow permissions
- Check for secret exposure in logs
- Verify OIDC vs. long-lived credentials usage
- Review branch protection and deployment gates

### 2. Cost Optimization Audit

**DynamoDB:**
- Analyze billing mode (PAY_PER_REQUEST vs. PROVISIONED)
- Check if auto-scaling is properly configured
- Review GSI usage and necessity
- Check for unused tables or indices
- Verify point-in-time recovery is only enabled in prod

**Lambda:**
- Review memory allocation (is it right-sized?)
- Check timeout configurations
- Analyze cold start optimization opportunities
- Review Lambda layer usage
- Check for unused functions

**S3:**
- Verify lifecycle policies are configured (Glacier archival)
- Check for old/unused buckets
- Review versioning settings
- Check bucket size and storage class optimization

**CloudFront:**
- Review cache hit ratio potential
- Check for unnecessary distributions
- Verify edge location configuration

**General:**
- Identify orphaned resources not managed by CloudFormation
- Check for resources in wrong regions
- Review CloudWatch log retention policies
- Identify zombie resources from failed deployments

### 3. Infrastructure Audit

**CDK Best Practices:**
- Review stack organization and dependencies
- Check for hardcoded values that should be parameterized
- Verify proper use of CDK constructs (L1 vs. L2 vs. L3)
- Check for missing stack outputs
- Review removal policies (DESTROY vs. RETAIN)
- Verify proper tagging strategy

**Resource Configuration:**
- Check environment-specific configurations (dev/test/prod)
- Verify production hardening (deletion protection, backups, etc.)
- Review monitoring and alerting setup
- Check for missing CloudWatch alarms
- Verify proper error handling in Step Functions

**Architecture:**
- Review single-table DynamoDB design efficiency
- Check for over-provisioned resources
- Identify potential bottlenecks
- Review API design and data flow
- Check for anti-patterns

### 4. Code Quality Audit

**TypeScript/Code:**
- Review TypeScript strict mode compliance
- Check for proper error handling
- Verify type safety across packages
- Review ES Modules usage
- Check for code duplication

**Testing:**
- Verify test coverage
- Check for missing unit tests
- Review test quality and effectiveness
- Identify untested critical paths

**Dependencies:**
- Check for outdated npm packages
- Identify security vulnerabilities in dependencies
- Review package-lock.json consistency
- Check for unused dependencies

### 5. Operational Audit

**Monitoring:**
- Verify CloudWatch Logs are properly configured
- Check log retention policies
- Review missing metrics or dashboards
- Verify error tracking and alerting

**Backup & Recovery:**
- Check backup strategies for DynamoDB
- Verify point-in-time recovery settings
- Review disaster recovery procedures
- Check data retention policies

**CI/CD:**
- Review deployment automation
- Check for missing validation steps
- Verify rollback capabilities
- Review PR preview environment cleanup

## Output Format

Provide a detailed report structured as:

```markdown
# AWS Infrastructure Audit Report
Generated: [Date]

## Executive Summary
[High-level findings and critical issues]

## Security Findings

### Critical Issues
- [List critical security issues]

### High Priority
- [List high priority issues]

### Medium Priority
- [List medium priority issues]

### Recommendations
- [List security recommendations]

## Cost Optimization Findings

### Current Cost Analysis
- [Estimated monthly costs by service]

### High-Impact Optimizations
- [List cost reduction opportunities with estimated savings]

### Low-Impact Optimizations
- [List minor optimization opportunities]

## Infrastructure Findings

### Configuration Issues
- [List configuration problems]

### Best Practice Violations
- [List CDK/AWS best practice violations]

### Improvement Opportunities
- [List infrastructure improvements]

## Code Quality Findings

### Issues
- [List code quality issues]

### Recommendations
- [List code improvements]

## Operational Findings

### Monitoring Gaps
- [List missing monitoring/alerting]

### Process Improvements
- [List operational improvements]

## Action Items

### Immediate (Fix within 24 hours)
1. [Critical item 1]
2. [Critical item 2]

### Short-term (Fix within 1 week)
1. [High priority item 1]
2. [High priority item 2]

### Long-term (Plan for next sprint)
1. [Medium priority item 1]
2. [Medium priority item 2]

## Compliance & Standards

### AWS Well-Architected Framework
- Security: [Score/10]
- Cost Optimization: [Score/10]
- Reliability: [Score/10]
- Performance Efficiency: [Score/10]
- Operational Excellence: [Score/10]

### Detailed Analysis
[Analysis per pillar]

## Summary
[Overall assessment and next steps]
```

## Instructions

1. Read and analyze all relevant files:
   - CDK stacks in `packages/infrastructure/lib/`
   - Lambda functions in `packages/functions/src/`
   - GitHub workflows in `.github/workflows/`
   - Scripts in `scripts/`
   - Configuration files (package.json, tsconfig.json, etc.)

2. Check for common issues:
   - Hardcoded credentials or secrets
   - Overly permissive IAM policies
   - Missing encryption
   - Public S3 buckets
   - Expensive resource configurations
   - Missing monitoring/alarms
   - Outdated dependencies

3. Use tools where applicable:
   - Check npm packages: `npm audit`
   - Review dependencies: `npm outdated`
   - Scan for secrets: Check for patterns like API keys, tokens

4. Provide actionable recommendations with:
   - Specific code changes
   - Configuration adjustments
   - Estimated impact (cost savings, security improvement, etc.)
   - Priority level (critical, high, medium, low)

5. Focus on this project's specific architecture:
   - Multi-environment setup (dev/test/prod)
   - Monorepo with npm workspaces
   - ES Modules Lambda functions
   - Single-table DynamoDB design
   - AppSync GraphQL API
   - Jira Dashboard feature
   - GitHub Actions CI/CD

## Success Criteria

The audit is complete when:
- All 5 audit areas are thoroughly analyzed
- Findings are prioritized by severity and impact
- Actionable recommendations are provided
- Cost impact is estimated for optimization opportunities
- Security risks are clearly identified
- A clear action plan is provided
