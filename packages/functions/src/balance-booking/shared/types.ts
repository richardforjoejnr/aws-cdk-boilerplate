export type ClassLevel = 1 | 2 | 3 | 'ALL';

export type ClassFormat = 'REFORMER' | 'MAT' | 'BARRE' | 'INFRARED_REFORMER' | 'INFRARED_MAT';

export interface ClassInstance {
  classInstanceId: string;
  classTypeSlug: string;
  classTypeName: string;
  level: ClassLevel;
  format: ClassFormat;
  startsAt: string;
  durationMin: number;
  capacity: number;
  booked: number;
  instructor: string;
  priceGBP: number;
  membersOnly?: boolean;
}

export interface BasketItem {
  classInstanceId: string;
}

export interface Booking {
  bookingId: string;
  userId: string;
  classInstanceId: string;
  classDate: string;
  classTypeName: string;
  startsAt: string;
  status: 'CONFIRMED' | 'CANCELLED';
  paymentMethod: 'STUB' | 'STRIPE' | 'PASS' | 'MEMBERSHIP';
  createdAt: string;
}

export interface MemberProfile {
  userId: string;
  email: string;
  name: string;
  phone?: string;
  parqCompletedAt?: string;
  parqAnswers?: Record<string, unknown>;
  role: 'MEMBER' | 'ADMIN';
}

export interface ParqSubmission {
  hasMedicalConditions: boolean;
  medicalDetails?: string;
  pregnant?: boolean;
  injuries?: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  acknowledgedAt: string;
}

export interface AppSyncIdentityCognito {
  sub: string;
  username: string;
  claims: {
    email?: string;
    'cognito:groups'?: string[];
    [key: string]: unknown;
  };
}

export interface AppSyncEvent<TArgs> {
  arguments: TArgs;
  identity: AppSyncIdentityCognito | null;
  info: { fieldName: string };
}
