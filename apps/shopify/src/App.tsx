import '@shopify/polaris/build/esm/styles.css';
import { AppProvider } from '@shopify/polaris';
import { Route, Routes } from 'react-router-dom';
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
      </Routes>
    </AppProvider>
  );
}
