import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface MerchantData {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  websiteUrl: string;
  creditBalance: number;
  isActive: boolean;
  kioskEnabled: boolean;
  maxKioskDevices: number;
  userId: string | null;
  createdAt: string;
}

export async function requireMerchant(): Promise<{ data: MerchantData; token: string }> {
  const cookieStore = await cookies();
  const token = cookieStore.get('merchant_access_token')?.value;
  if (!token) redirect('/login');

  const res = await fetch(`${API_URL}/v1/merchant/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) redirect('/login');

  const data = (await res.json()) as MerchantData;
  return { data, token };
}
