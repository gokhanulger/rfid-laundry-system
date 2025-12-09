import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tags, Building2, Package, Scan, Check, X, AlertCircle, Trash2 } from 'lucide-react';
import { itemsApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Tenant, ItemType } from '../types';

export function BulkTagAssignmentPage() {
  const [scannedTags, setScannedTags] = useState<string[]>([]);
  const [manualTag, setManualTag] = useState('');
  const [selectedHotelId, setSelectedHotelId] = useState('');
  const [selectedItemTypeId, setSelectedItemTypeId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignmentResults, setAssignmentResults] = useState<{success: number; failed: number; errors: string[]}>({
    success: 0,
    failed: 0,
    errors: []
  });
  const [showResults, setShowResults] = useState(false);

  const queryClient = useQueryClient();
  const toast = useToast();

  // Fetch hotels and item types
  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  const { data: itemTypes } = useQuery({
    queryKey: ['item-types'],
    queryFn: settingsApi.getItemTypes,
  });

  // Add manual tag
  const addManualTag = () => {
    const tag = manualTag.trim().toUpperCase();
    if (tag && !scannedTags.includes(tag)) {
      setScannedTags([...scannedTags, tag]);
      setManualTag('');
    }
  };

  // Remove tag
  const removeTag = (tag: string) => {
    setScannedTags(scannedTags.filter(t => t !== tag));
  };

  // Clear all tags
  const clearAllTags = () => {
    setScannedTags([]);
  };

  // Assign all tags
  const assignTags = async () => {
    if (!selectedHotelId || !selectedItemTypeId || scannedTags.length === 0) {
      toast.error('Lütfen otel, ürün tipi seçin ve en az bir etiket ekleyin');
      return;
    }

    setIsAssigning(true);
    setAssignmentResults({ success: 0, failed: 0, errors: [] });

    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const tag of scannedTags) {
      try {
        await itemsApi.create({
          rfidTag: tag,
          itemTypeId: selectedItemTypeId,
          tenantId: selectedHotelId,
          status: 'at_hotel',
        });
        successCount++;
      } catch (err: any) {
        failedCount++;
        const errorMsg = getErrorMessage(err);
        if (errorMsg.includes('duplicate') || errorMsg.includes('already exists')) {
          errors.push(`${tag}: Bu etiket zaten kayıtlı`);
        } else {
          errors.push(`${tag}: ${errorMsg}`);
        }
      }
    }

    setAssignmentResults({ success: successCount, failed: failedCount, errors });
    setShowResults(true);
    setIsAssigning(false);

    if (successCount > 0) {
      toast.success(`${successCount} etiket başarıyla eşleştirildi`);
      queryClient.invalidateQueries({ queryKey: ['items'] });
      // Clear successfully assigned tags
      if (failedCount === 0) {
        setScannedTags([]);
      }
    }

    if (failedCount > 0) {
      toast.error(`${failedCount} etiket eşleştirilemedi`);
    }
  };

  const selectedHotel = tenants?.find((t: Tenant) => t.id === selectedHotelId);
  const selectedItemType = itemTypes?.find((t: ItemType) => t.id === selectedItemTypeId);

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-purple-100 rounded-lg">
          <Tags className="w-8 h-8 text-purple-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Toplu Tag Eşleştirme</h1>
          <p className="text-gray-500">RFID etiketlerini otel ve ürün tipiyle eşleştirin</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Panel - Tag Input */}
        <div className="space-y-6">
          {/* Manual Tag Entry */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Scan className="w-5 h-5 text-purple-600" />
              Etiket Ekle
            </h2>

            <div className="flex gap-2">
              <input
                type="text"
                value={manualTag}
                onChange={(e) => setManualTag(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && addManualTag()}
                placeholder="RFID etiket numarası girin..."
                className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-lg"
              />
              <button
                onClick={addManualTag}
                className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium"
              >
                Ekle
              </button>
            </div>

            <p className="mt-3 text-sm text-gray-500">
              C72 cihazından taradığınız etiketleri buraya yazın veya web tarayıcıda RFID okuyucu bağlıysa otomatik eklenecektir.
            </p>
          </div>

          {/* Scanned Tags List */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">
                Taranan Etiketler ({scannedTags.length})
              </h2>
              {scannedTags.length > 0 && (
                <button
                  onClick={clearAllTags}
                  className="flex items-center gap-1 text-red-600 hover:text-red-700 text-sm font-medium"
                >
                  <Trash2 className="w-4 h-4" />
                  Tümünü Temizle
                </button>
              )}
            </div>

            {scannedTags.length === 0 ? (
              <div className="py-12 text-center">
                <Tags className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">Henüz etiket eklenmedi</p>
                <p className="text-sm text-gray-400 mt-1">Yukarıdan etiket ekleyin</p>
              </div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto space-y-2">
                {scannedTags.map((tag, index) => (
                  <div
                    key={tag}
                    className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 flex items-center justify-center bg-purple-100 text-purple-600 rounded-full text-sm font-bold">
                        {index + 1}
                      </span>
                      <span className="font-mono font-medium text-gray-900">{tag}</span>
                    </div>
                    <button
                      onClick={() => removeTag(tag)}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Assignment Settings */}
        <div className="space-y-6">
          {/* Hotel Selection */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-teal-600" />
              Otel Seçin
            </h2>

            <div className="grid grid-cols-2 gap-3">
              {tenants?.map((tenant: Tenant) => (
                <button
                  key={tenant.id}
                  onClick={() => setSelectedHotelId(tenant.id)}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    selectedHotelId === tenant.id
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-gray-200 hover:border-teal-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {selectedHotelId === tenant.id && (
                      <Check className="w-5 h-5 text-teal-600" />
                    )}
                    <span className={`font-medium ${selectedHotelId === tenant.id ? 'text-teal-900' : 'text-gray-700'}`}>
                      {tenant.name}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Item Type Selection */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Package className="w-5 h-5 text-orange-600" />
              Ürün Tipi Seçin
            </h2>

            <div className="grid grid-cols-2 gap-3">
              {itemTypes?.map((type: ItemType) => (
                <button
                  key={type.id}
                  onClick={() => setSelectedItemTypeId(type.id)}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    selectedItemTypeId === type.id
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-200 hover:border-orange-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {selectedItemTypeId === type.id && (
                      <Check className="w-5 h-5 text-orange-600" />
                    )}
                    <span className={`font-medium ${selectedItemTypeId === type.id ? 'text-orange-900' : 'text-gray-700'}`}>
                      {type.name}
                    </span>
                  </div>
                  {type.description && (
                    <p className="text-xs text-gray-500 mt-1 ml-7">{type.description}</p>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Assignment Summary & Button */}
          <div className="bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl shadow-lg p-6 text-white">
            <h2 className="text-lg font-bold mb-4">Eşleştirme Özeti</h2>

            <div className="space-y-3 mb-6">
              <div className="flex justify-between items-center">
                <span className="text-purple-200">Etiket Sayısı:</span>
                <span className="font-bold text-2xl">{scannedTags.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-purple-200">Otel:</span>
                <span className="font-medium">{selectedHotel?.name || 'Seçilmedi'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-purple-200">Ürün Tipi:</span>
                <span className="font-medium">{selectedItemType?.name || 'Seçilmedi'}</span>
              </div>
            </div>

            <button
              onClick={assignTags}
              disabled={isAssigning || scannedTags.length === 0 || !selectedHotelId || !selectedItemTypeId}
              className="w-full py-4 bg-white text-purple-600 rounded-lg font-bold text-lg hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isAssigning ? (
                <>
                  <div className="w-5 h-5 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                  Eşleştiriliyor...
                </>
              ) : (
                <>
                  <Check className="w-6 h-6" />
                  {scannedTags.length} Etiketi Eşleştir
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Results Modal */}
      {showResults && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              {assignmentResults.failed === 0 ? (
                <Check className="w-6 h-6 text-green-600" />
              ) : (
                <AlertCircle className="w-6 h-6 text-yellow-600" />
              )}
              Eşleştirme Sonucu
            </h2>

            <div className="space-y-4 mb-6">
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                <span className="text-green-700 font-medium">Başarılı</span>
                <span className="text-2xl font-bold text-green-600">{assignmentResults.success}</span>
              </div>

              {assignmentResults.failed > 0 && (
                <div className="flex items-center justify-between p-4 bg-red-50 rounded-lg">
                  <span className="text-red-700 font-medium">Başarısız</span>
                  <span className="text-2xl font-bold text-red-600">{assignmentResults.failed}</span>
                </div>
              )}

              {assignmentResults.errors.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Hatalar:</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {assignmentResults.errors.map((error, i) => (
                      <p key={i} className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
                        {error}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowResults(false)}
              className="w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"
            >
              Tamam
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
