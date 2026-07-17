import { GraphQLClient } from 'graphql-request';
import { config } from './config';

let token: string | null = null;
export function setAuthToken(t: string | null) {
  token = t;
}

export function gqlClient(): GraphQLClient {
  // Send the Cognito ID token if signed in; otherwise fall back to the public API key
  // so unauthenticated visitors can still load the schedule (only fields tagged
  // @aws_api_key in the schema are accessible this way).
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = token;
  } else if (config.graphqlApiKey) {
    headers['x-api-key'] = config.graphqlApiKey;
  }
  return new GraphQLClient(config.graphqlUrl, { headers });
}

export interface ClassInstance {
  classInstanceId: string;
  classTypeSlug: string;
  classTypeName: string;
  level: 'L1' | 'L2' | 'L3' | 'ALL';
  format: string;
  startsAt: string;
  durationMin: number;
  capacity: number;
  booked: number;
  instructor: string;
  priceGBP: number;
  membersOnly?: boolean | null;
}

export interface Booking {
  bookingId: string;
  userId: string;
  classInstanceId: string;
  classDate: string;
  classTypeName: string;
  startsAt: string;
  status: 'CONFIRMED' | 'CANCELLED';
  paymentMethod: string;
  createdAt: string;
}

export interface MemberProfile {
  userId: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  parqCompletedAt?: string | null;
  role: string;
}
