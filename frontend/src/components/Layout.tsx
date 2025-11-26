import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Package,
  Sparkles,
  ArrowUp,
  RotateCcw,
  Bell,
  BarChart3,
  Settings,
  Truck,
  Shield,
  Printer,
  Box,
  LogOut,
  Building2,
  Users,
  Tag,
  Menu,
  X,
  FileText,
} from 'lucide-react';

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isHotelOwner = user?.role === 'hotel_owner';
  const isDriver = user?.role === 'driver';
  const isAdmin = user?.role === 'system_admin' || user?.role === 'laundry_manager';

  // Navigation for laundry staff (not hotel owners or drivers)
  const laundryNavigation = [
    { name: 'Kontrol Paneli', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Camasir Isleme', href: '/laundry-processing', icon: Sparkles },
    { name: 'Utu Etiketi', href: '/ironer-interface', icon: Printer },
    { name: 'Paketleme', href: '/packaging', icon: Box },
    { name: 'Irsaliye', href: '/irsaliye', icon: FileText },
    { name: 'Surucu Aktiviteleri', href: '/driver-activities', icon: Shield },
    { name: 'Teslimat Yonetimi', href: '/delivery-management', icon: Truck },
    { name: 'Yeniden Yikama', href: '/rewash-queue', icon: RotateCcw },
    { name: 'Uyarilar', href: '/alerts', icon: Bell },
    { name: 'Raporlar', href: '/reports', icon: BarChart3 },
    { name: 'Mutabakat', href: '/reconciliation', icon: FileText },
  ];

  // Navigation for hotel owners - only relevant pages
  const hotelNavigation = [
    { name: 'Kontrol Paneli', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Urunlerim', href: '/items', icon: Tag },
    { name: 'Mutabakat', href: '/reconciliation', icon: FileText },
    { name: 'Uyarilar', href: '/alerts', icon: Bell },
    { name: 'Raporlar', href: '/reports', icon: BarChart3 },
  ];

  // Navigation for drivers - simple and clear
  const driverNavigation = [
    { name: 'Kirli Toplama', href: '/driver/dirty-pickup', icon: ArrowUp },
    { name: 'Camasirhane Toplama', href: '/driver/laundry-pickup', icon: Package },
    { name: 'Otel Teslimati', href: '/driver/hotel-delivery', icon: Truck },
  ];

  // Admin navigation (only for system_admin and laundry_manager)
  const adminNavigation = [
    { name: 'Otel Yonetimi', href: '/hotels', icon: Building2 },
    { name: 'Kullanici Yonetimi', href: '/users', icon: Users },
    { name: 'Urun Yonetimi', href: '/items', icon: Tag },
    { name: 'Ayarlar', href: '/settings', icon: Settings },
  ];

  // Choose navigation based on role
  const navigation = isDriver ? driverNavigation : (isHotelOwner ? hotelNavigation : laundryNavigation);

  // Format role name for display in Turkish
  const formatRole = (role: string | undefined) => {
    if (!role) return '';
    const roleNames: Record<string, string> = {
      'system_admin': 'Sistem Yoneticisi',
      'laundry_manager': 'Camasirhane Muduru',
      'hotel_owner': 'Otel Sahibi',
      'operator': 'Operator',
      'driver': 'Surucu',
      'packager': 'Paketleyici',
    };
    return roleNames[role] || role;
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg touch-manipulation"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900">RFID Camasirhane</h1>
          {isDriver && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Surucu</span>}
          {isHotelOwner && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Otel</span>}
        </div>
        <div className="w-10" /> {/* Spacer for centering */}
      </div>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black bg-opacity-50"
          onClick={closeSidebar}
        />
      )}

      <div className="flex">
        {/* Sidebar */}
        <aside className={`
          fixed md:static inset-y-0 left-0 z-50
          w-72 md:w-64 bg-white border-r border-gray-200 min-h-screen flex flex-col
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}>
          {/* Sidebar Header */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">RFID Camasirhane</h1>
              {isHotelOwner && (
                <p className="text-xs text-blue-600 mt-1">Otel Portali</p>
              )}
              {isDriver && (
                <p className="text-xs text-green-600 mt-1">Surucu Portali</p>
              )}
            </div>
            <button
              onClick={closeSidebar}
              className="md:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-lg touch-manipulation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Hotel/Driver Info Banner */}
          {isHotelOwner && user?.tenantName && (
            <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
              <p className="text-xs text-blue-500 uppercase font-semibold">Oteliniz</p>
              <p className="text-sm font-bold text-blue-700">{user.tenantName}</p>
            </div>
          )}
          {isDriver && (
            <div className="px-4 py-3 bg-green-50 border-b border-green-100">
              <p className="text-xs text-green-600 uppercase font-semibold">Bugunun Gorevleri</p>
              <p className="text-sm font-bold text-green-700">Hazir!</p>
            </div>
          )}

          {/* Navigation */}
          <nav className="p-4 space-y-1 flex-1 overflow-y-auto">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={closeSidebar}
                  className={`flex items-center gap-3 px-3 py-3 md:py-2 rounded-lg transition-colors touch-manipulation ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-sm font-medium">{item.name}</span>
                </Link>
              );
            })}

            {/* Admin Section - only for admins, not hotel owners */}
            {isAdmin && !isHotelOwner && (
              <>
                <div className="pt-4 pb-2">
                  <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Yonetim
                  </p>
                </div>
                {adminNavigation.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={closeSidebar}
                      className={`flex items-center gap-3 px-3 py-3 md:py-2 rounded-lg transition-colors touch-manipulation ${
                        isActive
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-sm font-medium">{item.name}</span>
                    </Link>
                  );
                })}
              </>
            )}
          </nav>

          {/* User Info & Logout */}
          <div className="p-4 border-t border-gray-200 bg-white">
            <div className="mb-2 text-sm text-gray-600">
              <div className="font-medium">{user?.firstName} {user?.lastName}</div>
              <div className="text-xs text-gray-500">{formatRole(user?.role)}</div>
            </div>
            <button
              onClick={() => {
                closeSidebar();
                logout();
              }}
              className="flex items-center gap-2 w-full px-3 py-3 md:py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 rounded-lg touch-manipulation"
            >
              <LogOut className="w-4 h-4" />
              <span>Cikis Yap</span>
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 pt-14 md:pt-0 min-h-screen">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
