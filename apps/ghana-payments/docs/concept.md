# System Architecture Specification: Ghana Street Vendor Digital Payment & Soundbox Platform

> Markdown conversion of `Expanded_Ghana_Digital_Payments_Concept.docx` (kept alongside in this folder). This is the authoritative planning reference for the PoC.

**Purpose:** Define the target architecture, API domains, integration model, data design, security controls, deployment approach, and implementation roadmap for a scalable digital payment ecosystem supporting street vendors and micro-merchants across Ghana.

## 1. Executive Summary

The proposed platform is a mobile-first payment orchestration ecosystem for Ghanaian street vendors and micro-merchants. It enables vendors to accept fast, verifiable digital payments using QR codes, merchant IDs, USSD fallback flows, and optional audio payment confirmation devices. The goal is to reduce cash friction, prevent fake payment confirmations, improve vendor safety, and create a verified transaction history that can support future services such as micro-credit, inventory financing, insurance, and business analytics.

The architecture does not force vendors to adopt a single mobile network. While MTN serves as an anchor partner due to its market position, the platform remains fully interoperable. It leverages the GhIPSS/GhQR standard — a universal QR code and proxy pay system introduced by the Bank of Ghana to enable interoperability across banks, mobile money operators, and fintechs. The platform acts as a lightweight orchestration, merchant enablement, notification, and device management layer above existing payment rails like Telecel Cash, AT Money, and GhanaPay.

## 2. Business Problem & Market Context

Street vendors and micro-merchants in Ghana primarily operate in cash or manual Mobile Money (MoMo) peer-to-peer transfers using phone numbers. Currently, approximately 60% of hawkers resist formal QR codes due to perceived complexity, fear of taxation (such as the E-Levy on electronic transfers), and the need for physical cash at wholesale markets. Relying on manual USSD transfers results in slow checkout times and exposes vendors to fraud through fake payment screenshots. Furthermore, traditional 1D linear barcodes and point-of-sale systems require expensive hardware and reliable electricity, making them highly impractical for mobile hawkers. This reliance on cash and informal transfers creates a lack of transaction history, which ultimately limits vendors' access to formal financial products such as micro-loans.

## 3. Goals and Non-Goals

| Category | Definition |
| --- | --- |
| Primary goals | Enable QR-based payments, standardize merchant onboarding, verify transaction completion, trigger soundbox/audio confirmation, manage merchant settlements, and provide reporting. |
| Secondary goals | Generate transaction history for credit scoring, improve financial inclusion, reduce street cash exposure, and provide a platform for value-added services. |
| Non-goals for MVP | Becoming a licensed bank, replacing all existing mobile wallets, providing full POS inventory management, or building a national identity platform from scratch. |
| Design principle | Use existing payment rails where possible; build the lightweight orchestration and merchant experience layer above them. |

## 4. User Personas

| Persona | Description | Key Needs |
| --- | --- | --- |
| Vendor / Hawker | Sells goods or services on the street, in markets, at stations, or from a mobile tray/cart. | Fast payment confirmation, low fees, simple onboarding, no expensive hardware, local language support. |
| Customer | Pays vendor using mobile wallet, bank app, GhanaPay, or USSD. | Quick payment, confidence that vendor received funds, minimal steps. |
| Field Agent | Registers vendors, verifies identity, prints/assigns QR badge, pairs soundbox devices, trains vendors. | Simple onboarding app, identity capture, inventory control, live test transaction flow. |
| Platform Admin | Manages merchants, agents, devices, risk rules, reporting, and support escalation. | Dashboards, audit logs, reconciliation, role-based access. |
| Payment Partner | MTN, Telecel, AT, bank, GhIPSS/GhQR, payment aggregator. | Secure API integration, settlement accuracy, transaction reporting, compliance. |
| Device / Soundbox | Connected speaker device that receives confirmed payment events and announces payment. | Reliable connectivity, secure pairing, low latency, offline recovery. |

## 5. High-Level Architecture

At a high level, the platform operates across seven major layers:

- **Channel layer:** QR codes, USSD, merchant app, customer wallet apps, field agent app, admin portal.
- **API gateway layer:** Authentication, rate limiting, request validation, routing, and observability.
- **Core service layer:** Merchant, QR, payment orchestration, wallet integration, device, notification, settlement, reporting.
- **Integration layer:** MTN MoMo, GhIPSS/GhQR, Telecel Cash, AT Money, GhanaPay, bank APIs, SMS/WhatsApp providers.
- **Event layer:** Message broker for payment events, device notifications, retries, webhooks, and audit trails.
- **Data layer:** Merchant database, transaction ledger, settlement records, device registry, analytics store.
- **Operations layer:** Monitoring, support tools, fraud review, admin dashboards, configuration management.

### 5.1 Logical Architecture Diagram

```
[Customer Wallet / Bank App / USSD]
              |
              v
      [QR / Merchant ID Resolver]
              |
              v
         [API Gateway]
              |
              v
 [Payment Orchestration Service] -----> [MTN MoMo API]
              |                         [Telecel Cash API]
              |                         [AT Money API]
              |                         [GhanaPay / Bank APIs]
              |                         [GhIPSS / GhQR]
              |
              v
       [Transaction Ledger]
              |
              +-----> [Notification Service] -----> [SMS / WhatsApp / Push]
              |
              +-----> [Device Event Broker] -----> [Soundbox Device]
              |
              +-----> [Settlement & Reconciliation]
              |
              +-----> [Reporting / Analytics / Credit Signals]
```

## 6. Core System Components

| Component | Responsibility | Notes |
| --- | --- | --- |
| API Gateway | Single entry point for external and internal API traffic. | Handles TLS, routing, rate limits, auth validation, request tracing. |
| Merchant Service | Stores merchant profile, KYC level, wallet links, settlement preferences, status. | Must support individual micro-merchants and business merchants. |
| QR Service | Generates and manages static/dynamic QR codes and merchant IDs. | Supports GhQR format, platform QR, and provider-specific QR references. |
| Payment Orchestrator | Routes payment requests to correct provider and normalizes provider responses. | Core abstraction layer that prevents vendor lock-in. |
| Wallet Integration Adapters | Provider-specific API connectors for MTN, Telecel, AT, banks, aggregators. | Adapters isolate external API differences. |
| Webhook Receiver | Receives callbacks from providers and converts them into internal transaction events. | Must be idempotent and signature verified. |
| Transaction Ledger | Authoritative internal record of payment attempts, confirmations, reversals, fees, and settlements. | Do not rely only on provider logs. |
| Notification Service | Sends SMS, WhatsApp, push, and in-app confirmations. | Should support English and local languages. |
| Soundbox Device Service | Registers, pairs, monitors, and pushes payment events to devices. | MQTT or secure WebSocket recommended. |
| Settlement Service | Calculates merchant payouts, fees, partner splits, and reconciliation differences. | Can begin as reporting-only if provider settles directly. |
| Agent App / Portal | Field onboarding, Ghana Card capture, QR assignment, device pairing, test payment. | Critical for real-world adoption. |
| Admin Portal | Operations console for merchant support, risk review, device health, reporting. | RBAC required. |

## 7. End-to-End Transaction Flows

### 7.1 QR Payment Flow — Static QR

1. Vendor displays a laminated QR badge tied to a merchant profile.
2. Customer scans QR using a wallet, bank app, or camera-enabled payment app.
3. QR resolves to merchant_id, provider routing details, and supported payment methods.
4. Customer enters amount and authorizes payment with wallet PIN or bank authentication.
5. Payment provider processes transaction and returns pending/accepted status.
6. Provider sends callback/webhook to platform after success, failure, or timeout.
7. Webhook Receiver validates signature, idempotency key, and transaction reference.
8. Transaction Ledger records final status.
9. Notification Service sends confirmation to vendor and customer.
10. Device Service pushes event to soundbox for audio announcement.

### 7.2 USSD Fallback Flow

Because not all customers use smartphones, the platform supports a USSD fallback. The vendor QR badge displays a short merchant code. Customers with basic feature phones can dial a provider-specific or aggregated USSD code, enter the merchant code and amount, confirm the merchant's name, and authorize with a PIN. The provider then sends a webhook to the platform, triggering the vendor notification and soundbox announcement.

## 8. API Architecture

The API is organized into domains, each implemented as a distinct service or module.

### 8.1 Merchant API

| Endpoint | Method | Purpose | Key Fields |
| --- | --- | --- | --- |
| `/v1/merchants` | POST | Create a merchant profile. | name, phone, ghana_card_hash, location, preferred_wallet, kyc_level |
| `/v1/merchants/{id}` | GET | Retrieve merchant profile. | merchant_id |
| `/v1/merchants/{id}` | PATCH | Update merchant data. | status, wallet, location, business_type |
| `/v1/merchants/{id}/wallets` | POST | Attach wallet account. | provider, wallet_number, account_name |
| `/v1/merchants/{id}/status` | PATCH | Suspend/reactivate merchant. | status, reason |

### 8.2 QR API

| Endpoint | Method | Purpose | Key Fields |
| --- | --- | --- | --- |
| `/v1/merchants/{id}/qrs` | POST | Generate or assign QR code. | qr_type, provider_mode, print_reference |
| `/v1/qrs/{qr_id}` | GET | Retrieve QR metadata. | qr_id |
| `/v1/qrs/{qr_id}/resolve` | GET | Resolve scanned QR to merchant/payment options. | qr_id, customer_provider |
| `/v1/qrs/{qr_id}/rotate` | POST | Replace compromised QR. | reason |
| `/v1/qrs/{qr_id}/status` | PATCH | Activate/deactivate QR. | status |

### 8.3 Payment API

| Endpoint | Method | Purpose | Notes |
| --- | --- | --- | --- |
| `/v1/payments` | POST | Initiate payment request. | Used by app/channel when platform initiates collection. |
| `/v1/payments/{id}` | GET | Get payment status. | Returns normalized status. |
| `/v1/payments/{id}/verify` | POST | Force provider verification. | Useful when webhook is delayed. |
| `/v1/payments/{id}/refunds` | POST | Initiate refund where supported. | Requires role-based permission. |
| `/v1/webhooks/{provider}` | POST | Provider callback endpoint. | Signature verification required. |

### 8.4 Device API

| Endpoint | Method | Purpose | Key Fields |
| --- | --- | --- | --- |
| `/v1/devices` | POST | Register soundbox device. | serial_number, model, firmware_version |
| `/v1/devices/{id}/pair` | POST | Pair device to merchant. | merchant_id, pairing_code |
| `/v1/devices/{id}/events` | POST | Send device command/event. | event_type, payload |
| `/v1/devices/{id}/heartbeat` | POST | Device health check. | battery, signal, firmware_version |
| `/v1/devices/{id}/status` | PATCH | Suspend, replace, or activate device. | status, reason |

## 9. Webhook Specification

All provider webhooks must be treated as untrusted until verified. The platform normalizes each provider's callback into a standard internal event schema.

Internal Payment Event Schema example:

```json
{
  "event_id": "evt_01HXYZ",
  "event_type": "PAYMENT_CONFIRMED",
  "provider": "MTN_MOMO",
  "provider_transaction_id": "123456789",
  "payment_id": "pay_01HXYZ",
  "merchant_id": "mer_123",
  "amount": 20.0,
  "currency": "GHS",
  "event_time": "2026-07-09T12:00:06Z",
  "raw_payload_ref": "s3://webhooks/mtn/2026/07/09/evt_01HXYZ.json"
}
```

## 10. Soundbox Architecture

The soundbox is a major differentiator because vendors need immediate confirmation without checking SMS or phone screens. The platform supports dedicated IoT soundboxes using MQTT over TLS for low-bandwidth, persistent messaging.

### 10.1 MQTT Topic Design

| Topic | Direction | Purpose |
| --- | --- | --- |
| `devices/{device_id}/payments` | Backend → Device | Payment confirmation announcement |
| `devices/{device_id}/commands` | Backend → Device | Volume, reboot, test announcement, config update |
| `devices/{device_id}/config` | Backend → Device | Configuration updates |
| `devices/{device_id}/ota` | Backend → Device | Firmware over-the-air updates |
| `devices/{device_id}/heartbeat` | Device → Backend | Device online status, battery, signal strength |

### 10.2 Device Pairing Flow

1. Field agent scans device serial number from the box.
2. Agent selects merchant profile in the agent app.
3. Platform generates a short pairing code or QR pairing token.
4. Device sends a pairing request with its serial number and token.
5. Device Service validates the token and binds device_id to merchant_id.
6. Agent performs a 1 GHS test transaction.
7. Soundbox announces confirmation; device status changes to ACTIVE.

## 11. Data Model

The conceptual schema supports the MVP and allows future expansion.

| Table | Purpose | Important Fields |
| --- | --- | --- |
| merchants | Stores vendor profile. | merchant_id, display_name, phone, kyc_level, status, business_category, created_at |
| merchant_wallets | Stores wallet/bank payout accounts. | wallet_id, merchant_id, provider, wallet_number_token, account_name, is_primary |
| qr_codes | Stores QR metadata and status. | qr_id, merchant_id, qr_type, qr_payload, status, print_batch_id |
| payments | Authoritative payment record. | payment_id, merchant_id, amount, currency, provider, status, channel, confirmed_at |
| payment_events | Event history for each payment. | event_id, payment_id, event_type, provider_payload_ref, created_at |
| devices | Soundbox inventory. | device_id, serial_number, model, firmware_version, status |
| device_pairings | Merchant-device relationship. | device_id, merchant_id, paired_at, unpaired_at, status |
| settlements | Daily or batch settlement records. | settlement_id, merchant_id, gross_amount, fees, net_amount, status |
| agents | Field onboarding team users. | agent_id, name, phone, region, status |
| audit_logs | Security and admin audit trail. | actor_id, action, resource_type, resource_id, timestamp, ip_address |

## 12. Security Architecture & Fraud Controls

| Area | Requirement |
| --- | --- |
| Authentication | Use OAuth2/OIDC for admin and partner APIs. Use device certificates or signed device tokens for soundboxes. |
| Authorization | Role-based access control: Admin, Support, Field Agent, Finance, Partner, Read-Only Analyst. |
| Transport security | TLS 1.2+ for all API, webhook, and device connections. MQTT must use TLS. |
| Data protection | Encrypt sensitive data at rest. Tokenize wallet numbers and national IDs. |
| Fraud prevention | Detect duplicate payments, unusual transaction velocity, mismatched merchant names, excessive refunds, and suspicious device re-pairing. |
| Auditability | Log all administrative changes, merchant status changes, payment adjustments, and settlement overrides. |
| Privacy | Collect minimum data required for merchant onboarding and payment operations. |

### 12.1 Key Fraud Scenarios and Controls

| Scenario | Risk | Control |
| --- | --- | --- |
| Fake screenshot | Customer shows fake payment proof. | Vendor relies on platform audio/device confirmation only, not screenshot. |
| Duplicate webhook | Provider sends callback multiple times. | Idempotency keys and unique provider transaction constraint. |
| QR tampering | Fraudster replaces vendor QR. | Tamper-resistant badge, merchant name confirmation, QR rotation, periodic field audit. |
| Device hijacking | Soundbox paired to wrong merchant. | Pairing token, serial verification, agent authentication, device certificate. |
| Refund abuse | Unauthorized refunds or reversals. | RBAC, approval workflow, audit logs. |
| SIM swap | Vendor wallet phone number compromised. | Wallet changes require step-up verification and cooling-off window. |

## 13. Settlement and Reconciliation

Settlement will be implemented in phases:

| Phase | Settlement Model | Technical Requirement |
| --- | --- | --- |
| MVP | Provider settles directly to vendor wallet. | Platform reconciles webhook confirmations against provider transaction reports. |
| Phase 2 | Aggregator or platform-managed settlement. | Settlement ledger, fee calculation, payout instructions, bank/wallet disbursement APIs. |
| Phase 3 | Multi-partner revenue sharing. | Automated split rules, partner statements, finance dashboards, dispute workflow. |

## 14. Deployment Architecture

A cloud-native deployment is recommended, utilizing AWS or Azure.

```
Internet
   |
[Cloud Load Balancer / WAF]
   |
[API Gateway]
   |
[Container Platform: ECS / EKS / AKS / Kubernetes]
   |------ Merchant Service
   |------ Payment Orchestrator
   |------ Webhook Receiver
   |------ Device Service
   |------ Notification Service
   |------ Settlement Service
   |
[PostgreSQL Primary + Read Replica]
[Redis Cache]
[Message Broker: RabbitMQ / Kafka]
[Object Storage: Raw webhooks, reports, exports]
[Monitoring: Prometheus/Grafana + Log Platform]
```

> **PoC note:** in this repo the PoC maps this reference deployment onto the existing serverless stack (API Gateway + Lambda + DynamoDB + EventBridge + AWS IoT Core for MQTT). See `../README.md` for the mapping.

## 15. Non-Functional Requirements

| Requirement | Target |
| --- | --- |
| Availability | 99.5% MVP; 99.9% after production hardening. |
| Payment event latency | Webhook to soundbox announcement target under 5 seconds under normal network conditions. |
| Scalability | Design for 10,000 merchants in pilot; scalable to 1,000,000+ merchants nationally. |
| Data retention | Raw webhook payloads retained according to compliance requirements; transaction summaries retained for merchant history. |
| Observability | Distributed tracing, structured logs, metrics, alerting, and dashboards. |
| Localization | Support English first, then Twi, Ga, Ewe, Hausa, and other local languages for audio and SMS templates. |
| Offline tolerance | Devices should recover missed announcements using last-known event sync where feasible. |

## 16. Future Roadmap

| Phase | Capabilities |
| --- | --- |
| Phase 2 | Inventory-lite, merchant analytics, digital receipts, WhatsApp bot, bulk onboarding tools. |
| Phase 3 | Credit scoring, micro-loans, inventory financing, insurance, and loyalty programs. |
| Phase 4 | National partner ecosystem, municipal permits, tax-friendly micro-merchant tier support, open partner APIs. |

## 17. MTN MoMo Sound Box — Detailed Configuration Plan

> Note: Any production deployment must be validated with MTN Ghana and approved partner dashboard credentials before go-live.

### 17.1 Key MTN MoMo API Facts

The MTN MoMo APIs are RESTful and return JSON responses. The relevant product for merchant collections is the Collections / Get Paid API, which includes the Request to Pay and Payment Status endpoints. The sandbox environment uses `sandbox.momodeveloper.mtn.com` as the base URL; production typically uses `proxy.momoapi.mtn.com` after MTN approval. Access tokens are generated using the API user and API key with the relevant subscription key. The token response includes `access_token`, `token_type`, and `expires_in` values.

Request to Pay is asynchronous — the system must support both callbacks and payment status polling as a fallback. For Ghana, the currency is GHS and the production `X-Target-Environment` value must be confirmed directly with MTN Ghana (commonly referenced as `mtnghana` in public documentation). Sandbox test MSISDN values can return different statuses including Failed, Rejected, Timeout, Success, or Pending.

### 17.2 End-to-End Configuration Steps

1. Sign up or log into the MTN MoMo Developer Portal.
2. Subscribe to the Collections product and obtain the Collections subscription key.
3. Create or retrieve the API user and API key. For sandboxes, these can be generated from the developer flow; for production, MTN will provision credentials after approval and KYC.
4. Configure the provider callback host. The callback URL host must match what is configured with MTN.
5. Build a backend service with endpoints for token generation, request-to-pay initiation, payment status polling, and callback handling.
6. Create merchant records and map each merchant wallet/account to a specific sound box device ID.
7. Create device authentication credentials and register each sound box in the database.
8. Implement MQTT/WebSocket messaging so the backend can publish transaction alerts to the correct device.
9. Implement device-side audio playback and/or text-to-speech for payment announcements.
10. Test sandbox flows using sandbox test MSISDNs and simulated success, failed, rejected, timeout, and pending statuses.
11. Complete MTN Ghana production onboarding, KYC, IP/domain requirements, credential issuance, and go-live validation.

### 17.3 Environment Variables

```bash
# .env.example
NODE_ENV=development
PORT=3000

MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
# Production: https://proxy.momoapi.mtn.com

MOMO_COLLECTION_SUBSCRIPTION_KEY=replace_with_collections_subscription_key
MOMO_API_USER=replace_with_api_user
MOMO_API_KEY=replace_with_api_key
MOMO_TARGET_ENVIRONMENT=sandbox
# Production Ghana: confirm with MTN Ghana. Common reference: mtnghana
MOMO_CURRENCY=GHS
MOMO_CALLBACK_URL=https://your-domain.com/api/momo/callback

DATABASE_URL=postgres://postgres:postgres@localhost:5432/soundbox
MQTT_URL=mqtt://localhost:1883
MQTT_USERNAME=soundbox_backend
MQTT_PASSWORD=replace_with_strong_password
JWT_SECRET=replace_with_strong_secret
```

### 17.4 Database Schema (reference — relational form)

```sql
CREATE TABLE merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_name TEXT NOT NULL,
  momo_account_msisdn TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  device_serial TEXT UNIQUE NOT NULL,
  mqtt_client_id TEXT UNIQUE NOT NULL,
  device_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  device_id UUID REFERENCES devices(id),
  momo_reference_id UUID UNIQUE NOT NULL,
  external_id TEXT UNIQUE NOT NULL,
  payer_msisdn TEXT,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  status TEXT NOT NULL DEFAULT 'PENDING',
  reason TEXT,
  raw_payload JSONB,
  announced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE device_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 17.5 Sandbox cURL Scripts

Generate Access Token:

```bash
curl -X POST "https://sandbox.momodeveloper.mtn.com/collection/token/" \
  -H "Ocp-Apim-Subscription-Key: YOUR_COLLECTION_SUBSCRIPTION_KEY" \
  -H "X-Target-Environment: sandbox" \
  -u "YOUR_API_USER:YOUR_API_KEY" \
  -d ""
```

Request to Pay:

```bash
REFERENCE_ID=$(uuidgen)

curl -X POST "https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Ocp-Apim-Subscription-Key: YOUR_COLLECTION_SUBSCRIPTION_KEY" \
  -H "X-Reference-Id: $REFERENCE_ID" \
  -H "X-Target-Environment: sandbox" \
  -H "X-Callback-Url: https://your-domain.com/api/momo/callback" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "10.00",
    "currency": "EUR",
    "externalId": "merchant-order-1001",
    "payer": { "partyIdType": "MSISDN", "partyId": "56733123453" },
    "payerMessage": "Payment for goods",
    "payeeNote": "Thank you"
  }'
```

> Note: The sandbox uses EUR and test MSISDN values. For Ghana production, use GHS and live Ghana MSISDN format as approved by MTN Ghana.

Get Payment Status:

```bash
curl -X GET "https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/YOUR_REFERENCE_ID" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Ocp-Apim-Subscription-Key: YOUR_COLLECTION_SUBSCRIPTION_KEY" \
  -H "X-Target-Environment: sandbox"
```

### 17.6 Node.js Backend Sample (reference — Express/Postgres/MQTT form)

```javascript
// server.js (ESM)
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import mqtt from 'mqtt';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();
const app = express();
app.use(express.json());

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const mqttClient = mqtt.connect(process.env.MQTT_URL, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD
});

let cachedToken = null;
let tokenExpiresAt = 0;

async function getMomoToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;
  const response = await axios.post(
    `${process.env.MOMO_BASE_URL}/collection/token/`, '',
    {
      auth: { username: process.env.MOMO_API_USER, password: process.env.MOMO_API_KEY },
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.MOMO_COLLECTION_SUBSCRIPTION_KEY,
        'X-Target-Environment': process.env.MOMO_TARGET_ENVIRONMENT
      }
    }
  );
  cachedToken = response.data.access_token;
  tokenExpiresAt = Date.now() + (response.data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function publishPaymentToDevice(device, transaction) {
  const topic = `devices/${device.mqtt_client_id}/payments`;
  const payload = {
    event_type: 'ANNOUNCE_PAYMENT',
    payment_id: transaction.momo_reference_id,
    amount: transaction.amount,
    currency: transaction.currency,
    language: 'en',
    message: `Payment received. ${transaction.amount} Ghana cedis.`,
    priority: 'HIGH',
    ttl_seconds: 300,
    timestamp: new Date().toISOString()
  };
  mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
}

app.post('/api/momo/callback', async (req, res) => {
  const referenceId = req.body?.financialTransactionId || req.headers['x-reference-id'];
  if (referenceId) await processPaymentStatus(referenceId, req.body);
  res.status(200).json({ received: true });
});

async function processPaymentStatus(referenceId, rawPayload = {}) {
  const token = await getMomoToken();
  const { data: momo } = await axios.get(
    `${process.env.MOMO_BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': process.env.MOMO_COLLECTION_SUBSCRIPTION_KEY,
        'X-Target-Environment': process.env.MOMO_TARGET_ENVIRONMENT
      }
    }
  );
  const status = momo.status || 'UNKNOWN';
  const txResult = await pool.query(
    `UPDATE transactions SET status=$1, reason=$2, raw_payload=$3, updated_at=now()
     WHERE momo_reference_id=$4 RETURNING *`,
    [status, momo.reason || null, momo, referenceId]
  );
  if (!txResult.rowCount) return;
  const tx = txResult.rows[0];
  if (status === 'SUCCESSFUL' && !tx.announced_at) {
    const deviceResult = await pool.query(
      `SELECT d.* FROM devices d WHERE d.merchant_id=$1 AND d.status='active'
       ORDER BY d.created_at ASC LIMIT 1`,
      [tx.merchant_id]
    );
    if (deviceResult.rowCount) {
      await publishPaymentToDevice(deviceResult.rows[0], tx);
      await pool.query('UPDATE transactions SET announced_at=now() WHERE id=$1', [tx.id]);
    }
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(process.env.PORT || 3000);
```

### 17.7 ESP32 Sound Box Firmware (Arduino)

```cpp
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
// For production audio, use an audio DAC/I2S amplifier and stored MP3 prompts
// or a TTS-capable module.

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* MQTT_HOST = "YOUR_MQTT_HOST";
const int   MQTT_PORT = 1883;
const char* MQTT_USER = "DEVICE_USERNAME";
const char* MQTT_PASS = "DEVICE_PASSWORD";
const char* CLIENT_ID = "soundbox-001";

WiFiClient espClient;
PubSubClient mqtt(espClient);

void announcePayment(const char* amount, const char* currency) {
  Serial.print("Payment received: ");
  Serial.print(amount);
  Serial.print(" ");
  Serial.println(currency);
  // TODO: Replace with audio playback:
  // playAudio("payment_received.mp3");
  // speakAmount(amount, currency);
}

void callback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, payload, length)) return;
  const char* event = doc["event_type"] | "";
  if (strcmp(event, "ANNOUNCE_PAYMENT") == 0) {
    announcePayment(doc["amount"] | "0", doc["currency"] | "GHS");
    String ackTopic = String("devices/") + CLIENT_ID + "/heartbeat";
    mqtt.publish(ackTopic.c_str(), "{\"status\":\"played\"}");
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(callback);
}

void loop() {
  if (!mqtt.connected()) {
    if (mqtt.connect(CLIENT_ID, MQTT_USER, MQTT_PASS)) {
      mqtt.subscribe((String("devices/") + CLIENT_ID + "/payments").c_str(), 1);
    } else { delay(3000); }
  }
  mqtt.loop();
  static unsigned long lastHeartbeat = 0;
  if (millis() - lastHeartbeat > 60000) {
    lastHeartbeat = millis();
    mqtt.publish(
      (String("devices/") + CLIENT_ID + "/heartbeat").c_str(),
      "{\"status\":\"online\"}"
    );
  }
}
```

### 17.8 Error Handling and Retry Model

| Scenario | Recommended Handling |
| --- | --- |
| MTN returns PENDING | Store as pending and poll status until terminal state or timeout. |
| Callback not received | Use scheduled polling by reference ID. |
| Duplicate callback | Ignore if transaction already marked as announced. |
| MQTT publish fails | Queue event and retry until device acknowledges. |
| Device offline | Store event and deliver when heartbeat resumes; optionally send SMS/app alert to merchant. |
| MTN token expired | Refresh token and retry once. |
| 401 Unauthorized | Regenerate sandbox API user/key if applicable; confirm production credentials and subscription key. |
| Invalid callback URL host | Confirm callback host matches the providerCallbackHost configured with MTN. |
| Wrong target environment | Confirm sandbox vs. Ghana production target environment with MTN Ghana. |

### 17.9 Soundbox Hardware Options

| Option | Description | Pros | Cons |
| --- | --- | --- | --- |
| Dedicated 4G soundbox | SIM-enabled device receives events via MQTT/WebSocket. | Reliable, loud, purpose-built. | Hardware cost and logistics. |
| Wi-Fi soundbox | Device uses vendor phone hotspot or nearby Wi-Fi. | Cheaper data path. | Less reliable for mobile hawkers. |
| Android app audio mode | Merchant app speaks payment confirmations. | No extra hardware. | Phone battery, background restrictions, theft risk. |
| Bluetooth speaker paired to phone | Phone app receives notification and plays via speaker. | Low device cost. | More setup complexity. |

## 18. MVP Scope

| MVP Feature | Included |
| --- | --- |
| Merchant onboarding | Create vendor profile, attach wallet, assign QR. |
| QR payment support | Static QR payment flow with provider integration. |
| Webhook processing | Receive, validate, normalize, and record payment confirmations. |
| Vendor notifications | SMS or WhatsApp confirmation. |
| Soundbox pilot | Register, pair, and announce payment on limited device set. |
| Admin portal | Merchant lookup, payment lookup, device status, issue support. |
| Basic reporting | Daily sales, transaction history, reconciliation export. |
| Security baseline | RBAC, audit logs, encrypted secrets, signed webhooks. |

## 19. Implementation Workstreams

| Workstream | Key Deliverables |
| --- | --- |
| Product | MVP requirements, user journeys, merchant onboarding workflow, agent workflow. |
| Architecture | Service design, API standards, data model, integration strategy, security model. |
| Backend Engineering | Merchant, QR, payment, webhook, device, notification, settlement services. |
| Mobile / Agent App | Vendor registration, QR assignment, device pairing, test payment. |
| Device Engineering | Firmware, MQTT client, audio files/TTS, heartbeat, OTA updates. |
| DevOps | Cloud environments, CI/CD, monitoring, secrets, backups. |
| Compliance | KYC policy, data privacy, payment partner agreements, audit controls. |
| Field Operations | Agent training, merchant education, pilot support, device logistics. |

## 20. Status Enumerations

| Domain | Statuses |
| --- | --- |
| Merchant | PENDING_KYC, ACTIVE, SUSPENDED, CLOSED |
| QR | ACTIVE, INACTIVE, ROTATED, COMPROMISED |
| Payment | INITIATED, PENDING, SUCCESS, FAILED, EXPIRED, REVERSED, REFUNDED |
| Device | UNASSIGNED, PAIRED, ACTIVE, OFFLINE, SUSPENDED, RETIRED |
| Settlement | OPEN, CALCULATED, SUBMITTED, PAID, FAILED, RECONCILED |

## 21. Open Technical Decisions

Several architectural decisions require confirmation before development begins:

1. Direct integration with MTN/Telecel/AT APIs vs. a licensed payment aggregator first.
2. GhQR as the primary QR standard from day one vs. a platform QR that resolves to provider-specific payment flows.
3. Soundbox connectivity model: 4G SIM, Wi-Fi, Bluetooth-to-phone, or multiple device models (based on pilot market conditions).
4. Settlement approach: direct-to-wallet through providers or platform-managed through an aggregator.
5. KYC tier requirements for individual micro-merchants.
6. Local language requirements for the initial soundbox pilot.
7. Acceptable merchant transaction fee model for adoption.

## 22. Recommended Next Steps

- Confirm anchor partner strategy: MTN direct integration, aggregator partnership, or hybrid.
- Create API integration discovery checklist for MTN MoMo, GhIPSS/GhQR, Telecel, AT Money, GhanaPay, and SMS/WhatsApp providers.
- Define MVP pilot size: 100 vendors for technical pilot, then 1,000 vendors for field pilot.
- Create clickable prototype for merchant onboarding and payment confirmation.
- Build sandbox integration with one provider and a simulated provider adapter.
- Prototype soundbox communication using MQTT and test payment events.
- Finalize data privacy and KYC requirements before collecting live merchant data.

## Appendix A: API Error Model

```json
{
  "error": {
    "code": "PAYMENT_PROVIDER_TIMEOUT",
    "message": "Payment provider did not respond within the expected time.",
    "correlation_id": "corr_01HXYZ",
    "details": {
      "provider": "MTN_MOMO",
      "retryable": true
    }
  }
}
```

## Appendix B: Webhook Controls

| Control | Requirement |
| --- | --- |
| Signature validation | Verify HMAC or provider signature using stored provider secret. Reject unsigned callbacks. |
| Idempotency | Use provider_transaction_id and internal payment_id to prevent duplicate ledger postings. |
| Replay protection | Reject callbacks outside allowed timestamp window where provider supports timestamps. |
| Retry handling | Return 2xx only after durable write to event inbox/ledger. Provider retries must be safe. |
| Event inbox | Persist raw webhook payload before processing for audit and troubleshooting. |

## Appendix C: Production Go-Live Checklist

The following items must be completed before any production deployment:

- Provider contracts and sandbox credentials secured.
- Webhook URLs registered and verified.
- Secrets managed through cloud secret manager, not environment files.
- Database backups and restore testing completed.
- Fraud and duplicate detection tested.
- Device pairing and unpairing tested.
- Support playbook and incident escalation paths documented.
- Pilot vendors trained and test transactions completed.
- Monitoring dashboards and alerts configured.
- Go/no-go criteria approved by technical and business stakeholders.
- Complete MTN Ghana API application, KYC, and commercial onboarding.
- Confirm production base URL, target environment, currency, callback host, MSISDN format, and all required headers with MTN Ghana.
- Perform UAT with at least 5 merchant accounts and multiple payment amounts.
- Validate successful, failed, rejected, pending, timeout, and duplicate transaction paths.
- Complete security review and secret rotation plan.
- Validate device provisioning, pairing, factory reset, firmware update, and lost-device revocation.

## Appendix D: Support and Operations Model

The support model operates across three tiers. Tier 1 merchant support verifies device power, network status, volume, and recent payment history. Tier 2 technical operations reviews backend logs, MTN status, transaction status, and MQTT delivery. Tier 3 involves MTN or device/vendor support to investigate API, settlement, firmware, or hardware defects. Daily reconciliation should compare MTN dashboard totals, backend transaction records, and merchant reports. A field process must exist for device replacement, SIM replacement, Wi-Fi changes, and device re-pairing.
