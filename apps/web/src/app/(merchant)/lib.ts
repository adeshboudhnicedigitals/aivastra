import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface WidgetSettings {
  widgetName?: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  primaryColor?: string;
  buttonColor?: string;
  bgColor?: string;
  borderRadius?: number;
  shadow?: boolean;
  minSizeMb?: number;
  maxSizeMb?: number;
  cameraUpload?: boolean;
  customCss?: string;
}

export interface MerchantData {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  websiteUrl: string;
  widgetKey: string;
  creditBalance: number;
  isActive: boolean;
  allowedOrigins: string[];
  settings: WidgetSettings;
  createdAt: string;
}

export async function requireMerchant(): Promise<{ data: MerchantData; token: string }> {
  const cookieStore = await cookies();
  const token = cookieStore.get('merchant_access_token')?.value;
  if (!token) redirect('/merchant/login');

  const res = await fetch(`${API_URL}/v1/merchant/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) redirect('/merchant/login');

  const data = (await res.json()) as MerchantData;
  return { data, token };
}
