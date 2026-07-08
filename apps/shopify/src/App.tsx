import '@shopify/polaris/build/esm/styles.css';
import { AppProvider } from '@shopify/polaris';
import { Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  return (
    <AppProvider i18n={{}}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
      </Routes>
    </AppProvider>
  );
}
