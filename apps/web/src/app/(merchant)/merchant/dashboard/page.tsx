import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function getMerchantData(token: string) {
  const res = await fetch(`${API_URL}/v1/merchant/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json() as Promise<{
    id: string;
    companyName: string;
    contactName: string;
    email: string;
    phone: string;
    websiteUrl: string;
    widgetKey: string;
    creditBalance: number;
    isActive: boolean;
    createdAt: string;
  }>;
}

export default async function MerchantDashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('merchant_access_token')?.value;
  if (!token) redirect('/merchant/login');

  const data = await getMerchantData(token);
  if (!data) redirect('/merchant/login');

  return <DashboardContent data={data} token={token} />;
}

import { DashboardContent } from './DashboardContent';
