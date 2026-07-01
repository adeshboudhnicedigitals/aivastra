import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

const basename = import.meta.env.PROD ? '/panel' : '/';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
