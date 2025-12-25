#!/bin/bash

# Restore DynamoDB table data from backup
# Usage: ./scripts/restore-table.sh <stage> [backup-file]
# Example: ./scripts/restore-table.sh pr-5 backups/pr-5-main-table-20250125-120000.json

set -e

STAGE=${1}
BACKUP_FILE=${2}
REGION=${AWS_REGION:-us-east-1}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -z "$STAGE" ]; then
    echo -e "${RED}❌ Error: Stage is required${NC}"
    echo "Usage: $0 <stage> [backup-file]"
    echo "Example: $0 pr-5 backups/pr-5-main-table-20250125-120000.json"
    exit 1
fi

TABLE_NAME="${STAGE}-main-table"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                  DynamoDB Table Restore                        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Stage:${NC} $STAGE"
echo -e "${YELLOW}Table:${NC} $TABLE_NAME"
echo -e "${YELLOW}Region:${NC} $REGION"
echo ""

# If no backup file specified, list available backups
if [ -z "$BACKUP_FILE" ]; then
    echo -e "${BLUE}📋 Available backups:${NC}"
    echo ""

    # List JSON backups
    if ls backups/${STAGE}-main-table-*.json 1> /dev/null 2>&1; then
        echo -e "${GREEN}Local JSON backups:${NC}"
        for file in backups/${STAGE}-main-table-*.json; do
            if [ -f "$file.meta" ]; then
                ITEMS=$(cat "$file.meta" | jq -r '.itemCount')
                TIMESTAMP=$(cat "$file.meta" | jq -r '.timestamp')
                SIZE=$(du -h "$file" | cut -f1)
                echo -e "  - ${file} (${ITEMS} items, ${SIZE}, ${TIMESTAMP})"
            else
                SIZE=$(du -h "$file" | cut -f1)
                echo -e "  - ${file} (${SIZE})"
            fi
        done
        echo ""
    fi

    # List AWS backups
    echo -e "${GREEN}AWS backups:${NC}"
    aws dynamodb list-backups \
        --table-name "$TABLE_NAME" \
        --region "$REGION" \
        --query 'BackupSummaries[*].[BackupName,BackupCreationDateTime,BackupStatus]' \
        --output table || echo "  No AWS backups found"

    echo ""
    echo -e "${YELLOW}To restore from a backup, run:${NC}"
    echo -e "  ${BLUE}$0 $STAGE <backup-file>${NC}"
    exit 0
fi

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}✗ Backup file not found: ${BACKUP_FILE}${NC}"
    exit 1
fi

# Check if table exists
echo -e "${BLUE}📋 Checking if table exists...${NC}"
if ! aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo -e "${RED}✗ Table does not exist. Please create it first:${NC}"
    echo -e "  ${BLUE}./scripts/deploy-with-cleanup.sh ${STAGE} --webapp${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Table exists${NC}"
echo ""

# Get current item count
CURRENT_COUNT=$(aws dynamodb scan \
    --table-name "$TABLE_NAME" \
    --select COUNT \
    --region "$REGION" \
    --output json | jq -r '.Count')

echo -e "${YELLOW}Current items in table: ${CURRENT_COUNT}${NC}"

if [ "$CURRENT_COUNT" -gt 0 ]; then
    echo -e "${RED}⚠️  WARNING: Table already contains data!${NC}"
    echo -e "${YELLOW}Do you want to overwrite? (y/n)${NC}"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Restore cancelled.${NC}"
        exit 0
    fi
fi

# Read backup file
echo -e "\n${BLUE}📦 Reading backup file...${NC}"

BACKUP_ITEMS=$(cat "$BACKUP_FILE" | jq -r '.Items')
ITEM_COUNT=$(echo "$BACKUP_ITEMS" | jq '. | length')

echo -e "${GREEN}✓ Backup file loaded${NC}"
echo -e "  Items to restore: ${ITEM_COUNT}"
echo ""

# Restore items
echo -e "${BLUE}🔄 Restoring items...${NC}"
echo -e "${YELLOW}This may take a while...${NC}"

RESTORED=0
FAILED=0

# Write items in batches of 25 (DynamoDB BatchWriteItem limit)
BATCH_SIZE=25
TOTAL_BATCHES=$(( (ITEM_COUNT + BATCH_SIZE - 1) / BATCH_SIZE ))

for ((i=0; i<ITEM_COUNT; i+=BATCH_SIZE)); do
    BATCH_NUM=$(( i / BATCH_SIZE + 1 ))
    echo -ne "\r  Processing batch ${BATCH_NUM}/${TOTAL_BATCHES}..."

    # Extract batch
    BATCH=$(echo "$BACKUP_ITEMS" | jq -c ".[$i:$((i+BATCH_SIZE))]")

    # Create batch write request
    REQUEST='{"'$TABLE_NAME'": ['

    for item in $(echo "$BATCH" | jq -c '.[]'); do
        REQUEST="${REQUEST}{\"PutRequest\":{\"Item\":${item}}},"
    done

    # Remove trailing comma and close
    REQUEST="${REQUEST%,}]}"

    # Write batch
    if aws dynamodb batch-write-item \
        --request-items "$REQUEST" \
        --region "$REGION" >/dev/null 2>&1; then
        BATCH_SIZE_ACTUAL=$(echo "$BATCH" | jq '. | length')
        RESTORED=$((RESTORED + BATCH_SIZE_ACTUAL))
    else
        BATCH_SIZE_ACTUAL=$(echo "$BATCH" | jq '. | length')
        FAILED=$((FAILED + BATCH_SIZE_ACTUAL))
    fi
done

echo ""
echo ""

# Summary
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                     Restore Complete                           ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Summary:${NC}"
echo -e "  Items in backup: ${ITEM_COUNT}"
echo -e "  Items restored: ${GREEN}${RESTORED}${NC}"
if [ "$FAILED" -gt 0 ]; then
    echo -e "  Items failed: ${RED}${FAILED}${NC}"
fi
echo ""

# Verify
FINAL_COUNT=$(aws dynamodb scan \
    --table-name "$TABLE_NAME" \
    --select COUNT \
    --region "$REGION" \
    --output json | jq -r '.Count')

echo -e "${BLUE}Final item count: ${FINAL_COUNT}${NC}"
echo ""

if [ "$FAILED" -eq 0 ]; then
    echo -e "${GREEN}✅ Restore completed successfully!${NC}"
else
    echo -e "${YELLOW}⚠️  Restore completed with some failures.${NC}"
    echo -e "${YELLOW}Please check the table manually.${NC}"
fi
echo ""
