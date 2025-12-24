import { useState, useEffect } from 'react';
import { FileText, Lock } from 'lucide-react';
import { IrsaliyePage } from './IrsaliyePage';
import api, { setStoredToken } from '../lib/api';

// Storage key for irsaliye authentication
const IRSALIYE_AUTH_KEY = 'laundry_irsaliye_auth';
const IRSALIYE_PIN = '1234'; // Default PIN for irsaliye

// Backend credentials for irsaliye station (uses admin for full access)
const IRSALIYE_CREDENTIALS = {
  email: 'admin@laundry.com',
  password: 'admin123',
};

export function IrsaliyeLoginPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Check if already authenticated on mount and re-authenticate with backend
  useEffect(() => {
    const initAuth = async () => {
      const savedAuth = localStorage.getItem(IRSALIYE_AUTH_KEY);
      if (savedAuth === 'true') {
        // Re-authenticate with backend to get fresh token
        try {
          const response = await api.post('/auth/login', IRSALIYE_CREDENTIALS);
          if (response.data?.token) {
            setStoredToken(response.data.token);
            console.log('[IrsaliyeLogin] Backend re-auth successful');
          }
        } catch (err) {
          console.error('[IrsaliyeLogin] Backend re-auth failed:', err);
        }
        setIsAuthenticated(true);
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const handlePinInput = async (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      setError('');

      // Auto-submit when 4 digits entered
      if (newPin.length === 4) {
        setTimeout(async () => {
          if (newPin === IRSALIYE_PIN) {
            // Authenticate with backend for API access
            try {
              const response = await api.post('/auth/login', IRSALIYE_CREDENTIALS);
              if (response.data?.token) {
                setStoredToken(response.data.token);
                console.log('[IrsaliyeLogin] Backend auth successful');
              }
            } catch (err) {
              console.error('[IrsaliyeLogin] Backend auth failed:', err);
              // Continue anyway - some features may work
            }
            localStorage.setItem(IRSALIYE_AUTH_KEY, 'true');
            setIsAuthenticated(true);
          } else {
            setError('Yanlis sifre');
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

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  // If authenticated, show the irsaliye interface
  if (isAuthenticated) {
    return <IrsaliyePage />;
  }

  // Show PIN entry screen
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-100 rounded-full mb-4">
            <FileText className="w-8 h-8 text-teal-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">RFID Camasirhane</h1>
          <p className="text-sm text-gray-500">by Karbeyaz & Demet Laundry</p>
          <p className="text-gray-500 mt-3">Irsaliye Istasyonu</p>
          <p className="text-gray-400 text-sm">Sifre girin</p>
        </div>

        {/* PIN Display */}
        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className={`w-14 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold transition-all ${
                pin.length > index
                  ? 'border-teal-500 bg-teal-50 text-teal-600'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              {pin.length > index ? (
                <div className="w-3 h-3 rounded-full bg-teal-600" />
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
            &larr;
          </button>
        </div>

        {/* Lock Icon */}
        <div className="mt-6 flex items-center justify-center text-gray-400">
          <Lock className="w-4 h-4 mr-1" />
          <span className="text-sm">Guvenli giris</span>
        </div>
      </div>
    </div>
  );
}
