import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from './components/Header';
import { SchedulePage } from './pages/SchedulePage';
import { BasketPage } from './pages/BasketPage';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { ParqPage } from './pages/ParqPage';
import { AdminPage } from './pages/AdminPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { RequireAuth } from './components/RequireAuth';

export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10">
        <Routes>
          <Route path="/" element={<SchedulePage />} />
          <Route
            path="/basket"
            element={
              <RequireAuth>
                <BasketPage />
              </RequireAuth>
            }
          />
          <Route
            path="/parq"
            element={
              <RequireAuth>
                <ParqPage />
              </RequireAuth>
            }
          />
          <Route
            path="/my/bookings"
            element={
              <RequireAuth>
                <MyBookingsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAuth>
                <AdminPage />
              </RequireAuth>
            }
          />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="border-t border-stone py-6 text-center text-text-muted text-sm">
        Balance UK — Pilates for every body
      </footer>
    </div>
  );
}
