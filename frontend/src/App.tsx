import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';

// Pages
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { BulkScanPage } from './pages/BulkScanPage';
import { LaundryProcessingPage } from './pages/LaundryProcessingPage';
import { InboundTrackingPage } from './pages/InboundTrackingPage';
import { OutboundTrackingPage } from './pages/OutboundTrackingPage';
import { RewashQueuePage } from './pages/RewashQueuePage';
import { AlertsPage } from './pages/AlertsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { DeliveryManagementPage } from './pages/DeliveryManagementPage';
import { DriverActivitiesPage } from './pages/DriverActivitiesPage';
import { DeliveryLogsPage } from './pages/DeliveryLogsPage';
import { LocationTestPage } from './pages/LocationTestPage';
import { IronerInterfacePage } from './pages/IronerInterfacePage';
import { PackagingPage } from './pages/PackagingPage';
import { HotelManagementPage } from './pages/HotelManagementPage';
import { UserManagementPage } from './pages/UserManagementPage';
import { ItemManagementPage } from './pages/ItemManagementPage';
import { BulkTagAssignmentPage } from './pages/BulkTagAssignmentPage';
import { ReconciliationPage } from './pages/ReconciliationPage';
import { IrsaliyePage } from './pages/IrsaliyePage';
import HotelQRCodesPage from './pages/HotelQRCodesPage';
import { HotelStatusBoardPage } from './pages/HotelStatusBoardPage';

// Driver Pages
import { DriverHomePage } from './pages/driver/DriverHomePage';
import { DirtyPickupPage } from './pages/driver/DirtyPickupPage';
import { DeliveryPage } from './pages/driver/DeliveryPage';
import { LaundryPickupPage } from './pages/driver/LaundryPickupPage';
import { HotelDeliveryPage } from './pages/driver/HotelDeliveryPage';

// Component to handle role-based redirects
function RoleBasedRedirect() {
  const { user } = useAuth();
  if (user?.role === 'driver') {
    return <Navigate to="/driver" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<RoleBasedRedirect />} />
                <Route path="dashboard" element={<DashboardPage />} />

                {/* Operations Pages */}
                <Route path="bulk-scan" element={<BulkScanPage />} />
                <Route path="laundry-processing" element={<LaundryProcessingPage />} />
                <Route path="inbound" element={<InboundTrackingPage />} />
                <Route path="outbound" element={<OutboundTrackingPage />} />
                <Route path="rewash-queue" element={<RewashQueuePage />} />

                {/* Management Pages */}
                <Route path="alerts" element={<AlertsPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="reconciliation" element={<ReconciliationPage />} />

                {/* Workflow Pages */}
                <Route path="delivery-management" element={<DeliveryManagementPage />} />
                <Route path="driver-activities" element={<DriverActivitiesPage />} />
                <Route path="delivery-logs" element={<DeliveryLogsPage />} />
                <Route path="location-test" element={<LocationTestPage />} />
                <Route path="ironer-interface" element={<IronerInterfacePage />} />
                <Route path="packaging" element={<PackagingPage />} />
                <Route path="irsaliye" element={<IrsaliyePage />} />

                {/* Admin Pages */}
                <Route path="hotels" element={<HotelManagementPage />} />
                <Route path="hotel-qr-codes" element={<HotelQRCodesPage />} />
                <Route path="hotel-status-board" element={<HotelStatusBoardPage />} />
                <Route path="users" element={<UserManagementPage />} />
                <Route path="items" element={<ItemManagementPage />} />
                <Route path="bulk-tag-assignment" element={<BulkTagAssignmentPage />} />

                {/* Driver Pages */}
                <Route path="driver" element={<DriverHomePage />} />
                <Route path="driver/dirty-pickup" element={<DirtyPickupPage />} />
                <Route path="driver/delivery" element={<DeliveryPage />} />
                <Route path="driver/laundry-pickup" element={<LaundryPickupPage />} />
                <Route path="driver/hotel-delivery" element={<HotelDeliveryPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
