import '@shopify/polaris/build/esm/styles.css';
import { AppProvider } from '@shopify/polaris';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import BillingPage from './pages/BillingPage';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';

export default function App() {
  return (
    <AppProvider i18n={{}}>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/embedded" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </AppProvider>
  );
}
