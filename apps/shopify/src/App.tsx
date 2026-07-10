import '@shopify/polaris/build/esm/styles.css';
import { AppProvider } from '@shopify/polaris';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import DashboardPage from './pages/DashboardPage';
import FunnelSetupPage from './pages/FunnelSetupPage';
import ProductsPage from './pages/ProductsPage';

export default function App() {
  return (
    <AppProvider i18n={{}}>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/funnel-setup" element={<FunnelSetupPage />} />
          <Route path="/embedded" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </AppProvider>
  );
}
