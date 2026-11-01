import type { ApplicationStatus } from '../types';
import type { PaymentStatus } from './enrollmentConfirmationService';

export type ReadinessInput = {
  applicationStatus: ApplicationStatus;
  requiredDocuments: number;
  passedDocuments: number;
  assignedCourses: number;
  paymentStatus: PaymentStatus | null;
};

export function assessEnrollmentReadiness(input: ReadinessInput) {
  const checks = {
    formReviewed: input.applicationStatus === 'documents_verified',
    documentsPassed: input.requiredDocuments > 0 && input.passedDocuments === input.requiredDocuments,
    subjectsAssigned: input.assignedCourses > 0,
    paymentReady: input.paymentStatus === 'verified' || input.paymentStatus === 'waived',
  };
  return { ...checks, ready: Object.values(checks).every(Boolean) };
}
