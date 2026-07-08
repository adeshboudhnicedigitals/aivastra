import '@shopify/polaris/build/esm/styles.css';
import { AppProvider } from '@shopify/polaris';
import { Navigate, Route, Routes } from 'react-router-dom';
import BillingPage from './pages/BillingPage';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';

export default function App() {
  return (
    <AppProvider i18n={{}}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/products" element={<ProductsPage />} />
        {/* OAuth install callback and billing callback both redirect to
            SHOPIFY_APP_URL + "/embedded" -- this is the embedded app's real
            home per Shopify, so route it to the Dashboard rather than 404. */}
        <Route path="/embedded" element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  );
}
