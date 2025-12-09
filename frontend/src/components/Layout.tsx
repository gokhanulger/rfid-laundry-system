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
  Tags,
  Menu,
  X,
  FileText,
  ChevronLeft,
  ChevronRight,
  MapPin,
} from 'lucide-react';

// Storage key for sidebar state
const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed';

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return saved === 'true';
  });

  const toggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(newState));
  };

  // Role checks
  const isHotelOwner = user?.role === 'hotel_owner';
  const isDriver = user?.role === 'driver';
  const isIroner = user?.role === 'ironer';
  const isPackager = user?.role === 'packager';
  const isAuditor = user?.role === 'auditor';
  const isAdmin = user?.role === 'system_admin' || user?.role === 'laundry_manager';

  // Navigation for ironer (Utu Etiketi only)
  const ironerNavigation = [
    { name: 'Utu Etiketi', href: '/ironer-interface', icon: Printer },
  ];

  // Navigation for packager (Paketleme only)
  const packagerNavigation = [
    { name: 'Paketleme', href: '/packaging', icon: Box },
  ];

  // Navigation for auditor (Irsaliye only)
  const auditorNavigation = [
    { name: 'Irsaliye', href: '/irsaliye', icon: FileText },
  ];

  // Navigation for drivers
  const driverNavigation = [
    { name: 'Ana Sayfa', href: '/driver', icon: LayoutDashboard },
    { name: 'Toplama', href: '/driver/dirty-pickup', icon: ArrowUp },
    { name: 'Teslim Etme', href: '/driver/delivery', icon: Truck },
  ];

  // Navigation for hotel owners
  const hotelNavigation = [
    { name: 'Kontrol Paneli', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Urunlerim', href: '/items', icon: Tag },
    { name: 'Mutabakat', href: '/reconciliation', icon: FileText },
    { name: 'Uyarilar', href: '/alerts', icon: Bell },
    { name: 'Raporlar', href: '/reports', icon: BarChart3 },
  ];

  // Navigation for admin/laundry manager (full access)
  const adminFullNavigation = [
    { name: 'Kontrol Paneli', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Camasir Isleme', href: '/laundry-processing', icon: Sparkles },
    { name: 'Utu Etiketi', href: '/ironer-interface', icon: Printer },
    { name: 'Paketleme', href: '/packaging', icon: Box },
    { name: 'Irsaliye', href: '/irsaliye', icon: FileText },
    { name: 'Surucu Aktiviteleri', href: '/driver-activities', icon: Shield },
    { name: 'Teslimat Yonetimi', href: '/delivery-management', icon: Truck },
    { name: 'Teslimat Loglari', href: '/delivery-logs', icon: MapPin },
    { name: 'Yeniden Yikama', href: '/rewash-queue', icon: RotateCcw },
    { name: 'Uyarilar', href: '/alerts', icon: Bell },
    { name: 'Raporlar', href: '/reports', icon: BarChart3 },
    { name: 'Mutabakat', href: '/reconciliation', icon: FileText },
  ];

  // Admin management section
  const adminNavigation = [
    { name: 'Otel Yonetimi', href: '/hotels', icon: Building2 },
    { name: 'Kullanici Yonetimi', href: '/users', icon: Users },
    { name: 'Urun Yonetimi', href: '/items', icon: Tag },
    { name: 'Toplu Tag Eslestirme', href: '/bulk-tag-assignment', icon: Tags },
    { name: 'Ayarlar', href: '/settings', icon: Settings },
  ];

  // Choose navigation based on role
  const getNavigation = () => {
    if (isIroner) return ironerNavigation;
    if (isPackager) return packagerNavigation;
    if (isAuditor) return auditorNavigation;
    if (isDriver) return driverNavigation;
    if (isHotelOwner) return hotelNavigation;
    return adminFullNavigation; // admin, laundry_manager, operator
  };
  const navigation = getNavigation();

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
      'ironer': 'Utucu',
      'auditor': 'Irsaliye Sorumlusu',
    };
    return roleNames[role] || role;
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="h-screen overflow-hidden bg-gray-50">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-slate-800 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 -ml-2 text-slate-300 hover:bg-slate-700 rounded-lg touch-manipulation"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-white">RFID Camasirhane</h1>
          {isDriver && <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full">Surucu</span>}
          {isHotelOwner && <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">Otel</span>}
          {isIroner && <span className="text-xs bg-orange-600 text-white px-2 py-0.5 rounded-full">Utucu</span>}
          {isPackager && <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full">Paketci</span>}
          {isAuditor && <span className="text-xs bg-teal-600 text-white px-2 py-0.5 rounded-full">Irsaliye</span>}
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

      <div className="flex h-full">
        {/* Sidebar */}
        <aside className={`
          fixed md:static inset-y-0 left-0 z-50
          ${isCollapsed ? 'md:w-20' : 'md:w-64'} w-72 bg-slate-800 h-screen flex flex-col
          transform transition-all duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}>
          {/* Sidebar Header */}
          <div className={`flex-shrink-0 p-4 border-b border-slate-700 flex items-center ${isCollapsed ? 'md:justify-center' : 'justify-between'}`}>
            <div className={isCollapsed ? 'md:hidden' : ''}>
              <h1 className="text-xl font-bold text-white">RFID Camasirhane</h1>
              {isHotelOwner && (
                <p className="text-xs text-blue-400 mt-1">Otel Portali</p>
              )}
              {isDriver && (
                <p className="text-xs text-green-400 mt-1">Surucu Portali</p>
              )}
              {isIroner && (
                <p className="text-xs text-orange-400 mt-1">Utu Istasyonu</p>
              )}
              {isPackager && (
                <p className="text-xs text-indigo-400 mt-1">Paketleme Istasyonu</p>
              )}
              {isAuditor && (
                <p className="text-xs text-teal-400 mt-1">Irsaliye Istasyonu</p>
              )}
            </div>
            {/* Collapse toggle button - desktop only */}
            <button
              onClick={toggleCollapse}
              className="hidden md:flex p-2 text-slate-400 hover:bg-slate-700 hover:text-white rounded-lg transition-colors"
              title={isCollapsed ? 'Genislet' : 'Daralt'}
            >
              {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>
            {/* Close button - mobile only */}
            <button
              onClick={closeSidebar}
              className="md:hidden p-2 text-slate-400 hover:bg-slate-700 rounded-lg touch-manipulation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Hotel/Driver Info Banner */}
          {isHotelOwner && user?.tenantName && !isCollapsed && (
            <div className="flex-shrink-0 px-4 py-3 bg-blue-900/50 border-b border-slate-700">
              <p className="text-xs text-blue-400 uppercase font-semibold">Oteliniz</p>
              <p className="text-sm font-bold text-blue-300">{user.tenantName}</p>
            </div>
          )}
          {isDriver && !isCollapsed && (
            <div className="flex-shrink-0 px-4 py-3 bg-green-900/50 border-b border-slate-700">
              <p className="text-xs text-green-400 uppercase font-semibold">Bugunun Gorevleri</p>
              <p className="text-sm font-bold text-green-300">Hazir!</p>
            </div>
          )}

          {/* Navigation */}
          <nav className={`${isCollapsed ? 'md:p-2' : 'p-4'} p-4 space-y-1 flex-1 overflow-y-auto`}>
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={closeSidebar}
                  title={isCollapsed ? item.name : undefined}
                  className={`flex items-center ${isCollapsed ? 'md:justify-center' : ''} gap-3 px-3 py-3 md:py-2 rounded-lg transition-colors touch-manipulation ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white active:bg-slate-600'
                  }`}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span className={`text-sm font-medium ${isCollapsed ? 'md:hidden' : ''}`}>{item.name}</span>
                </Link>
              );
            })}

            {/* Admin Section - only for admins, not hotel owners */}
            {isAdmin && !isHotelOwner && (
              <>
                {!isCollapsed && (
                  <div className="pt-4 pb-2">
                    <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Yonetim
                    </p>
                  </div>
                )}
                {isCollapsed && <div className="hidden md:block pt-4 border-t border-slate-700 mt-4" />}
                {adminNavigation.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={closeSidebar}
                      title={isCollapsed ? item.name : undefined}
                      className={`flex items-center ${isCollapsed ? 'md:justify-center' : ''} gap-3 px-3 py-3 md:py-2 rounded-lg transition-colors touch-manipulation ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-300 hover:bg-slate-700 hover:text-white active:bg-slate-600'
                      }`}
                    >
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      <span className={`text-sm font-medium ${isCollapsed ? 'md:hidden' : ''}`}>{item.name}</span>
                    </Link>
                  );
                })}
              </>
            )}
          </nav>

          {/* User Info & Logout */}
          <div className={`flex-shrink-0 ${isCollapsed ? 'md:p-2' : 'p-4'} p-4 border-t border-slate-700 bg-slate-900`}>
            {!isCollapsed && (
              <div className="mb-2 text-sm">
                <div className="font-medium text-white">{user?.firstName} {user?.lastName}</div>
                <div className="text-xs text-slate-400">{formatRole(user?.role)}</div>
              </div>
            )}
            <button
              onClick={() => {
                closeSidebar();
                logout();
              }}
              title={isCollapsed ? 'Cikis Yap' : undefined}
              className={`flex items-center ${isCollapsed ? 'md:justify-center' : ''} gap-2 w-full px-3 py-3 md:py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white active:bg-slate-600 rounded-lg touch-manipulation`}
            >
              <LogOut className="w-4 h-4 flex-shrink-0" />
              <span className={isCollapsed ? 'md:hidden' : ''}>Cikis Yap</span>
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 pt-14 md:pt-0 h-screen overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
