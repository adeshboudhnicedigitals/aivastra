export interface PresignResult { url: string; expiresIn: number; }
export interface StorageProvider {
  presignPut(key: string, contentType: string, contentLength: number, expiresInSec?: number): Promise<PresignResult>;
  presignGet(key: string, expiresInSec?: number): Promise<PresignResult>;
  deleteObject(key: string): Promise<void>;
  publicUrl(key: string): string;
}
export { keys } from './keys';
export { createR2Provider } from './r2';
