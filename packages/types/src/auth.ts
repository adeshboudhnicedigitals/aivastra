import { z } from 'zod';
export const RegisterBody = z.object({
  email: z.string().email().max(254),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  displayName: z.string().min(1).max(80),
});
export const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});
export const TokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
