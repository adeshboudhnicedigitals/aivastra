import { z } from 'zod';
export const RegisterBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(80).optional(),
});
export const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});
export const TokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
