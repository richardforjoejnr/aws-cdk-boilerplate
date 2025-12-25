#!/bin/bash

# Backup DynamoDB table data
# Usage: ./scripts/backup-table.sh <stage>
# Example: ./scripts/backup-table.sh pr-5

set -e

STAGE=${1}
REGION=${AWS_REGION:-us-east-1}
BACKUP_DIR="backups"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -z "$STAGE" ]; then
    echo -e "${RED}❌ Error: Stage is required${NC}"
    echo "Usage: $0 <stage>"
    echo "Example: $0 pr-5"
    exit 1
fi

TABLE_NAME="${STAGE}-main-table"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${TABLE_NAME}-${TIMESTAMP}.json"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                  DynamoDB Table Backup                         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Stage:${NC} $STAGE"
echo -e "${YELLOW}Table:${NC} $TABLE_NAME"
echo -e "${YELLOW}Region:${NC} $REGION"
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Check if table exists
echo -e "${BLUE}📋 Checking if table exists...${NC}"
if ! aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo -e "${RED}✗ Table does not exist${NC}"
    exit 1
fi

# Get item count
ITEM_COUNT=$(aws dynamodb scan \
    --table-name "$TABLE_NAME" \
    --select COUNT \
    --region "$REGION" \
    --output json | jq -r '.Count')

echo -e "${GREEN}✓ Table exists${NC}"
echo -e "  Items to backup: ${ITEM_COUNT}"
echo ""

if [ "$ITEM_COUNT" -eq 0 ]; then
    echo -e "${YELLOW}⚠️  Table is empty. No backup needed.${NC}"
    exit 0
fi

# Option 1: AWS Backup (On-Demand Backup)
echo -e "${BLUE}📦 Option 1: Creating AWS on-demand backup...${NC}"

BACKUP_NAME="${TABLE_NAME}-${TIMESTAMP}"

aws dynamodb create-backup \
    --table-name "$TABLE_NAME" \
    --backup-name "$BACKUP_NAME" \
    --region "$REGION" >/dev/null

BACKUP_ARN=$(aws dynamodb list-backups \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query "BackupSummaries[?BackupName=='${BACKUP_NAME}'].BackupArn | [0]" \
    --output text)

echo -e "${GREEN}✓ AWS backup created${NC}"
echo -e "  Backup Name: ${BACKUP_NAME}"
echo -e "  Backup ARN: ${BACKUP_ARN}"
echo ""

# Option 2: Export data to JSON file
echo -e "${BLUE}📦 Option 2: Exporting data to JSON file...${NC}"
echo -e "${YELLOW}This may take a while for large tables...${NC}"

# Scan and export all items
aws dynamodb scan \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --output json > "$BACKUP_FILE"

EXPORTED_COUNT=$(cat "$BACKUP_FILE" | jq -r '.Items | length')

echo -e "${GREEN}✓ Data exported${NC}"
echo -e "  Exported items: ${EXPORTED_COUNT}"
echo -e "  File: ${BACKUP_FILE}"
echo -e "  Size: $(du -h "$BACKUP_FILE" | cut -f1)"
echo ""

# Create metadata file
METADATA_FILE="${BACKUP_FILE}.meta"
cat > "$METADATA_FILE" << EOF
{
  "tableName": "${TABLE_NAME}",
  "stage": "${STAGE}",
  "timestamp": "${TIMESTAMP}",
  "itemCount": ${EXPORTED_COUNT},
  "backupName": "${BACKUP_NAME}",
  "backupArn": "${BACKUP_ARN}",
  "region": "${REGION}"
}
EOF

echo -e "${GREEN}✓ Metadata file created: ${METADATA_FILE}${NC}"
echo ""

# Summary
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                     Backup Complete                            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}AWS Backup:${NC}"
echo -e "  Name: ${BACKUP_NAME}"
echo -e "  ARN: ${BACKUP_ARN}"
echo ""
echo -e "${BLUE}Local Backup:${NC}"
echo -e "  File: ${BACKUP_FILE}"
echo -e "  Items: ${EXPORTED_COUNT}"
echo ""
echo -e "${YELLOW}💡 To restore from AWS backup:${NC}"
echo -e "   aws dynamodb restore-table-from-backup \\"
echo -e "     --target-table-name ${TABLE_NAME}-restored \\"
echo -e "     --backup-arn ${BACKUP_ARN}"
echo ""
echo -e "${YELLOW}💡 To restore from JSON file:${NC}"
echo -e "   ./scripts/restore-table.sh ${STAGE} ${BACKUP_FILE}"
echo ""
