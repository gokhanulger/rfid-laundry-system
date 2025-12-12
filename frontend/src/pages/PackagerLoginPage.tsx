import { useState, useEffect } from 'react';
import { Package, Lock } from 'lucide-react';
import { PackagingPage } from './PackagingPage';

// Storage key for packager authentication
const PACKAGER_AUTH_KEY = 'laundry_packager_auth';
const PACKAGER_PIN = '5678'; // Default PIN for packager

export function PackagerLoginPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Check if already authenticated on mount
  useEffect(() => {
    const savedAuth = localStorage.getItem(PACKAGER_AUTH_KEY);
    if (savedAuth === 'true') {
      setIsAuthenticated(true);
    }
    setIsLoading(false);
  }, []);

  const handlePinInput = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      setError('');

      // Auto-submit when 4 digits entered
      if (newPin.length === 4) {
        setTimeout(() => {
          if (newPin === PACKAGER_PIN) {
            localStorage.setItem(PACKAGER_AUTH_KEY, 'true');
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // If authenticated, show the packaging interface
  if (isAuthenticated) {
    return <PackagingPage />;
  }

  // Show PIN entry screen
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 rounded-full mb-4">
            <Package className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">RFID Paketleme</h1>
          <p className="text-sm text-gray-500">by Karbeyaz Demet Laundry</p>
          <p className="text-gray-500 mt-3">Şifre girin</p>
        </div>

        {/* PIN Display */}
        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className={`w-14 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold transition-all ${
                pin.length > index
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-600'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              {pin.length > index ? (
                <div className="w-3 h-3 rounded-full bg-indigo-600" />
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
