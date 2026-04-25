import { GraphQLClient } from 'graphql-request';
import { config } from './config';

let token: string | null = null;
export function setAuthToken(t: string | null) {
  token = t;
}

export function gqlClient(): GraphQLClient {
  return new GraphQLClient(config.graphqlUrl, {
    headers: token ? { Authorization: token } : {},
  });
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
