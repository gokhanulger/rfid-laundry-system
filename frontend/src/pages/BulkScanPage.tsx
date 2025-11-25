import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Scan, Plus, Trash2, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { itemsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Item } from '../types';

export function BulkScanPage() {
  const [rfidInput, setRfidInput] = useState('');
  const [scannedTags, setScannedTags] = useState<string[]>([]);
  const [scanResults, setScanResults] = useState<{
    items: Item[];
    found: number;
    notFound: number;
    notFoundTags: string[];
  } | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const toast = useToast();

  const scanMutation = useMutation({
    mutationFn: (tags: string[]) => itemsApi.scan(tags),
    onSuccess: (data) => {
      setScanResults(data);
      if (data.notFound > 0) {
        toast.warning(`${data.found} items found, ${data.notFound} not found`);
      } else {
        toast.success(`${data.found} items found`);
      }
    },
    onError: (err) => toast.error('Scan failed', getErrorMessage(err)),
  });

  const markCleanMutation = useMutation({
    mutationFn: (itemIds: string[]) => itemsApi.markClean(itemIds),
    onSuccess: (data) => {
      toast.success(`${data.count} items marked as clean`);
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setSelectedItems(new Set());
      // Refresh scan results
      if (scannedTags.length > 0) {
        scanMutation.mutate(scannedTags);
      }
    },
    onError: (err) => toast.error('Failed to mark items', getErrorMessage(err)),
  });

  const handleAddTag = () => {
    const tags = rfidInput
      .split(/[\n,;]/)
      .map(t => t.trim())
      .filter(t => t && !scannedTags.includes(t));

    if (tags.length > 0) {
      setScannedTags([...scannedTags, ...tags]);
      setRfidInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setScannedTags(scannedTags.filter(t => t !== tag));
  };

  const handleScan = () => {
    if (scannedTags.length === 0) {
      toast.warning('Add at least one RFID tag');
      return;
    }
    scanMutation.mutate(scannedTags);
  };

  const handleClear = () => {
    setScannedTags([]);
    setScanResults(null);
    setSelectedItems(new Set());
  };

  const toggleSelectItem = (itemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const selectAll = () => {
    if (scanResults) {
      const eligibleItems = scanResults.items.filter(i =>
        i.status === 'at_laundry' || i.status === 'processing'
      );
      setSelectedItems(new Set(eligibleItems.map(i => i.id)));
    }
  };

  const handleMarkClean = () => {
    if (selectedItems.size === 0) {
      toast.warning('Select items to mark as clean');
      return;
    }
    markCleanMutation.mutate(Array.from(selectedItems));
  };

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-900">Bulk RFID Scan</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Scan className="w-5 h-5 text-blue-500" />
            RFID Tags Input
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Enter RFID Tags (one per line or comma-separated)
              </label>
              <textarea
                value={rfidInput}
                onChange={(e) => setRfidInput(e.target.value)}
                placeholder="Enter RFID tags..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAddTag}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Tags
              </button>
              <button
                onClick={handleClear}
                className="flex items-center gap-2 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Clear All
              </button>
            </div>

            {/* Tags List */}
            {scannedTags.length > 0 && (
              <div className="border rounded-lg p-3 max-h-48 overflow-y-auto">
                <p className="text-sm text-gray-500 mb-2">{scannedTags.length} tags added</p>
                <div className="flex flex-wrap gap-2">
                  {scannedTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 rounded-lg text-sm font-mono"
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleScan}
              disabled={scannedTags.length === 0 || scanMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scanMutation.isPending ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Scan className="w-5 h-5" />
              )}
              Scan Items
            </button>
          </div>
        </div>

        {/* Results Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            Scan Results
          </h2>

          {!scanResults ? (
            <div className="text-center py-12 text-gray-500">
              <Scan className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>Add RFID tags and click "Scan Items" to see results</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary */}
              <div className="flex gap-4">
                <div className="flex-1 p-3 bg-green-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-green-600">{scanResults.found}</p>
                  <p className="text-sm text-green-700">Found</p>
                </div>
                <div className="flex-1 p-3 bg-red-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-red-600">{scanResults.notFound}</p>
                  <p className="text-sm text-red-700">Not Found</p>
                </div>
              </div>

              {/* Not Found Tags */}
              {scanResults.notFoundTags.length > 0 && (
                <div className="p-3 bg-red-50 rounded-lg">
                  <div className="flex items-center gap-2 text-red-700 mb-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm font-medium">Tags not found in system:</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {scanResults.notFoundTags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 bg-red-100 text-red-800 rounded text-xs font-mono">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Found Items */}
              {scanResults.items.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <button
                      onClick={selectAll}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Select all eligible
                    </button>
                    <span className="text-sm text-gray-500">
                      {selectedItems.size} selected
                    </span>
                  </div>

                  <div className="border rounded-lg max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="p-2 text-left"></th>
                          <th className="p-2 text-left">RFID</th>
                          <th className="p-2 text-left">Type</th>
                          <th className="p-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scanResults.items.map(item => {
                          const canSelect = item.status === 'at_laundry' || item.status === 'processing';
                          return (
                            <tr key={item.id} className="border-t hover:bg-gray-50">
                              <td className="p-2">
                                <input
                                  type="checkbox"
                                  checked={selectedItems.has(item.id)}
                                  onChange={() => toggleSelectItem(item.id)}
                                  disabled={!canSelect}
                                  className="rounded border-gray-300 text-blue-600 disabled:opacity-50"
                                />
                              </td>
                              <td className="p-2 font-mono">{item.rfidTag}</td>
                              <td className="p-2">{item.itemType?.name || '-'}</td>
                              <td className="p-2">
                                <span className={`px-2 py-0.5 text-xs rounded status-${item.status}`}>
                                  {item.status.replace(/_/g, ' ')}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <button
                    onClick={handleMarkClean}
                    disabled={selectedItems.size === 0 || markCleanMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {markCleanMutation.isPending ? (
                      <RefreshCw className="w-5 h-5 animate-spin" />
                    ) : (
                      <CheckCircle className="w-5 h-5" />
                    )}
                    Mark {selectedItems.size} Items as Clean
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
