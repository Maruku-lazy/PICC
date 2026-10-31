import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { DemoProvider } from './context/DemoContext';
import { useSupabase } from './lib/backend';
const SupabaseProvider = lazy(async () => ({
  default: (await import('./context/SupabaseContext')).SupabaseProvider,
}));
import App from './App';
import './styles.css';
import './portal-theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {useSupabase ? <Suspense fallback={<p>Loading Supabase…</p>}><SupabaseProvider><App /></SupabaseProvider></Suspense> : <DemoProvider><App /></DemoProvider>}
    </BrowserRouter>
  </React.StrictMode>
);
