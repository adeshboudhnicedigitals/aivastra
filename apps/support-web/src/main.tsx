import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { BreadcrumbProvider } from './context/BreadcrumbContext.tsx';

// Support lives on its own subdomain (support.aivastra.com), mounted at the
// domain root — same pattern as admin-web.
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BreadcrumbProvider>
          <App />
        </BreadcrumbProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
