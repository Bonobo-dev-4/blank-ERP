import { z } from 'zod';
import { shortText, uuid } from '../common';

export const loginRequest = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(200),
});
export type LoginRequest = z.infer<typeof loginRequest>;

/** Shop-floor terminal login: employee code plus a short PIN. */
export const pinLoginRequest = z.object({
  employeeCode: shortText(50),
  pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits'),
  deviceId: z.string().trim().max(100).optional(),
});
export type PinLoginRequest = z.infer<typeof pinLoginRequest>;

export const refreshRequest = z.object({ refreshToken: z.string().min(10) });

export interface AuthenticatedUser {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly fullName: string;
  readonly employeeCode: string | null;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface LoginResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly user: AuthenticatedUser;
}

export const createUserRequest = z.object({
  email: z.string().trim().email().max(255),
  fullName: shortText(150),
  employeeCode: z.string().trim().max(50).nullish(),
  password: z.string().min(8).max(200),
  pin: z.string().regex(/^\d{4,8}$/).nullish(),
  roleIds: z.array(uuid).min(1, 'Assign at least one role'),
});
export type CreateUserRequest = z.infer<typeof createUserRequest>;

export const updateUserRequest = createUserRequest
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional() });
