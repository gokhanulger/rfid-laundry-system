import { useState, useEffect } from 'react';
import { Printer, Package, FileText, Lock, ArrowLeft } from 'lucide-react';
import { IronerInterfacePage } from './IronerInterfacePage';
import { PackagingPage } from './PackagingPage';
import { IrsaliyePage } from './IrsaliyePage';
import api, { setStoredToken } from '../lib/api';

type StationType = 'ironer' | 'packager' | 'auditor' | null;

// Storage keys
const STATION_AUTH_KEY = 'laundry_station_auth';

// PINs for each station
const STATION_PINS: Record<string, string> = {
  ironer: '1234',
  packager: '1234',
  auditor: '1234',
};

// Backend credentials for each station type
const STATION_CREDENTIALS: Record<string, { email: string; password: string }> = {
  ironer: {
    email: 'ironer@laundry.com',
    password: 'password123',
  },
  packager: {
    email: 'packager@laundry.com',
    password: 'password123',
  },
  auditor: {
    email: 'admin@laundry.com', // Use admin for auditor since they need full access
    password: 'admin123',
  },
};

const STATION_INFO = {
  ironer: {
    name: 'Ütücü',
    icon: Printer,
    color: 'orange',
    bgColor: 'bg-orange-100',
    textColor: 'text-orange-600',
    borderColor: 'border-orange-500',
    hoverBg: 'hover:bg-orange-50',
  },
  packager: {
    name: 'Paketçi',
    icon: Package,
    color: 'indigo',
    bgColor: 'bg-indigo-100',
    textColor: 'text-indigo-600',
    borderColor: 'border-indigo-500',
    hoverBg: 'hover:bg-indigo-50',
  },
  auditor: {
    name: 'İrsaliyeci',
    icon: FileText,
    color: 'teal',
    bgColor: 'bg-teal-100',
    textColor: 'text-teal-600',
    borderColor: 'border-teal-500',
    hoverBg: 'hover:bg-teal-50',
  },
};

export function StationLoginPage() {
  const [selectedStation, setSelectedStation] = useState<StationType>(null);
  const [authenticatedStation, setAuthenticatedStation] = useState<StationType>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Check if already authenticated on mount
  useEffect(() => {
    const initAuth = async () => {
      const savedAuth = localStorage.getItem(STATION_AUTH_KEY);
      if (savedAuth && ['ironer', 'packager', 'auditor'].includes(savedAuth)) {
        // Try to re-authenticate with backend for full access
        const creds = STATION_CREDENTIALS[savedAuth];
        if (creds) {
          try {
            const response = await api.post('/auth/login', {
              email: creds.email,
              password: creds.password,
            });
            if (response.data?.token) {
              setStoredToken(response.data.token);
              // Initialize SQLite and start sync in Electron
              if (window.electronAPI?.dbInit) {
                console.log('[StationLogin] Initializing SQLite database...');
                const initResult = await window.electronAPI.dbInit(response.data.token);
                console.log('[StationLogin] DB init result:', initResult);

                // Start full sync if no items cached
                if (initResult.success && (!initResult.stats?.itemsCount || initResult.stats.itemsCount === 0)) {
                  console.log('[StationLogin] No cached items, starting full sync...');
                  window.electronAPI.dbFullSync().then((syncResult: any) => {
                    console.log('[StationLogin] Full sync result:', syncResult);
                  });
                }
              }
            }
          } catch (err: any) {
            console.error('Backend re-auth failed (continuing anyway):', err);
            // Continue without token - public endpoints will still work
          }
        }
        // Always restore session if saved auth exists
        setAuthenticatedStation(savedAuth as StationType);
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const handlePinInput = async (digit: string) => {
    if (pin.length < 4 && selectedStation) {
      const newPin = pin + digit;
      setPin(newPin);
      setError('');

      // Auto-submit when 4 digits entered
      if (newPin.length === 4) {
        setTimeout(async () => {
          if (newPin === STATION_PINS[selectedStation]) {
            // Try to authenticate with backend for full access
            try {
              const creds = STATION_CREDENTIALS[selectedStation];
              const response = await api.post('/auth/login', {
                email: creds.email,
                password: creds.password,
              });
              if (response.data?.token) {
                setStoredToken(response.data.token);
                // Initialize SQLite and start sync in Electron
                if (window.electronAPI?.dbInit) {
                  console.log('[StationLogin] Initializing SQLite database...');
                  const initResult = await window.electronAPI.dbInit(response.data.token);
                  console.log('[StationLogin] DB init result:', initResult);

                  // Start full sync if no items cached
                  if (initResult.success && (!initResult.stats?.itemsCount || initResult.stats.itemsCount === 0)) {
                    console.log('[StationLogin] No cached items, starting full sync...');
                    window.electronAPI.dbFullSync().then((syncResult: any) => {
                      console.log('[StationLogin] Full sync result:', syncResult);
                    });
                  }
                }
              }
            } catch (err: any) {
              console.error('Backend auth failed (continuing anyway):', err);
              // Continue without token - public endpoints will still work
            }
            // Always allow access if PIN is correct
            localStorage.setItem(STATION_AUTH_KEY, selectedStation);
            setAuthenticatedStation(selectedStation);
          } else {
            setError('Yanlış şifre');
            setPin('');
          }
        }, 200);
      }
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  const handleBack = () => {
    setSelectedStation(null);
    setPin('');
    setError('');
  };

  const handleLogout = () => {
    localStorage.removeItem(STATION_AUTH_KEY);
    setAuthenticatedStation(null);
    setSelectedStation(null);
    setPin('');
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600"></div>
      </div>
    );
  }

  // If authenticated, show the appropriate interface
  if (authenticatedStation === 'ironer') {
    return (
      <div className="h-screen flex flex-col">
        <div className="bg-gray-900 text-white px-4 py-2 flex items-center justify-between">
          <span className="text-sm">Ütücü İstasyonu</span>
          <button
            onClick={handleLogout}
            className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
          >
            Çıkış
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <IronerInterfacePage />
        </div>
      </div>
    );
  }

  if (authenticatedStation === 'packager') {
    return (
      <div className="h-screen flex flex-col">
        <div className="bg-gray-900 text-white px-4 py-2 flex items-center justify-between">
          <span className="text-sm">Paketçi İstasyonu</span>
          <button
            onClick={handleLogout}
            className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
          >
            Çıkış
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <PackagingPage />
        </div>
      </div>
    );
  }

  if (authenticatedStation === 'auditor') {
    return (
      <div className="h-screen flex flex-col">
        <div className="bg-gray-900 text-white px-4 py-2 flex items-center justify-between">
          <span className="text-sm">İrsaliyeci İstasyonu</span>
          <button
            onClick={handleLogout}
            className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
          >
            Çıkış
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <IrsaliyePage />
        </div>
      </div>
    );
  }

  // Show station selection if no station selected
  if (!selectedStation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">RFID Çamaşırhane</h1>
            <p className="text-sm text-gray-500">by Karbeyaz & Demet Laundry</p>
            <p className="text-gray-500 mt-4">İstasyon seçin</p>
          </div>

          {/* Station Options */}
          <div className="space-y-4">
            {(['ironer', 'packager', 'auditor'] as const).map((station) => {
              const info = STATION_INFO[station];
              const Icon = info.icon;
              return (
                <button
                  key={station}
                  onClick={() => setSelectedStation(station)}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 ${info.hoverBg} transition-all hover:border-gray-300 hover:shadow-md`}
                >
                  <div className={`p-3 ${info.bgColor} rounded-lg`}>
                    <Icon className={`w-8 h-8 ${info.textColor}`} />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-gray-900 text-lg">{info.name}</p>
                    <p className="text-sm text-gray-500">
                      {station === 'ironer' && 'Ütü işlemleri'}
                      {station === 'packager' && 'Paketleme işlemleri'}
                      {station === 'auditor' && 'İrsaliye işlemleri'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Show PIN entry screen for selected station
  const stationInfo = STATION_INFO[selectedStation];
  const StationIcon = stationInfo.icon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        {/* Back Button */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Geri</span>
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          <div className={`inline-flex items-center justify-center w-16 h-16 ${stationInfo.bgColor} rounded-full mb-4`}>
            <StationIcon className={`w-8 h-8 ${stationInfo.textColor}`} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{stationInfo.name}</h1>
          <p className="text-gray-500 mt-2">Şifre girin</p>
        </div>

        {/* PIN Display */}
        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className={`w-14 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold transition-all ${
                pin.length > index
                  ? `${stationInfo.borderColor} ${stationInfo.bgColor} ${stationInfo.textColor}`
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              {pin.length > index ? (
                <div className={`w-3 h-3 rounded-full ${stationInfo.bgColor.replace('100', '600')}`} />
              ) : null}
            </div>
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <div className="text-center text-red-500 text-sm mb-4 animate-shake">
            {error}
          </div>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
            <button
              key={digit}
              onClick={() => handlePinInput(digit.toString())}
              className="h-16 text-2xl font-bold text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 active:bg-gray-300 transition-all"
            >
              {digit}
            </button>
          ))}
          <button
            onClick={handleClear}
            className="h-16 text-lg font-medium text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 active:bg-gray-300 transition-all"
          >
            Sil
          </button>
          <button
            onClick={() => handlePinInput('0')}
            className="h-16 text-2xl font-bold text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 active:bg-gray-300 transition-all"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="h-16 text-lg font-medium text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 active:bg-gray-300 transition-all"
          >
            ←
          </button>
        </div>

        {/* Lock Icon */}
        <div className="mt-6 flex items-center justify-center text-gray-400">
          <Lock className="w-4 h-4 mr-1" />
          <span className="text-sm">Güvenli giriş</span>
        </div>
      </div>
    </div>
  );
}
