import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, PieChart, TrendingUp, Download } from 'lucide-react';
import { reportsApi, dashboardApi, settingsApi } from '../lib/api';

export function ReportsPage() {
  const [selectedTenant, setSelectedTenant] = useState<string>('');

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  const { data: lifecycleReport, isLoading: loadingLifecycle } = useQuery({
    queryKey: ['lifecycle-report', selectedTenant],
    queryFn: () => reportsApi.getLifecycle({ tenantId: selectedTenant || undefined }),
  });

  const { data: itemTypeDistribution, isLoading: loadingDistribution } = useQuery({
    queryKey: ['item-type-distribution'],
    queryFn: dashboardApi.getItemTypeDistribution,
  });

  const { data: workflowData, isLoading: loadingWorkflow } = useQuery({
    queryKey: ['workflow'],
    queryFn: dashboardApi.getWorkflow,
  });

  const exportCSV = () => {
    if (!lifecycleReport) return;

    const rows = [
      ['Metrik', 'Deger'],
      ['Toplam Urunler', lifecycleReport.totalItems.toString()],
      ['Ortalama Yikama Sayisi', lifecycleReport.averageWashCount.toFixed(2)],
      [''],
      ['Durum', 'Sayi'],
      ...Object.entries(lifecycleReport.itemsByStatus).map(([status, count]) => [status, count.toString()]),
      [''],
      ['Urun Tipi', 'Sayi'],
      ...Object.entries(lifecycleReport.itemsByType).map(([type, count]) => [type, count.toString()]),
    ];

    const csv = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cmasir-raporu-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Raporlar</h1>
        <div className="flex items-center gap-4">
          <select
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Tum Oteller</option>
            {tenants?.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            onClick={exportCSV}
            disabled={!lifecycleReport}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            CSV Olarak Disari Aktar
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-100 rounded-lg">
              <BarChart3 className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="font-medium text-gray-700">Toplam Urunler</h3>
          </div>
          {loadingLifecycle ? (
            <div className="h-8 bg-gray-200 rounded animate-pulse" />
          ) : (
            <p className="text-3xl font-bold">{lifecycleReport?.totalItems.toLocaleString() || 0}</p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-100 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <h3 className="font-medium text-gray-700">Ort. Yikama Sayisi</h3>
          </div>
          {loadingLifecycle ? (
            <div className="h-8 bg-gray-200 rounded animate-pulse" />
          ) : (
            <p className="text-3xl font-bold">{lifecycleReport?.averageWashCount.toFixed(1) || 0}</p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-100 rounded-lg">
              <PieChart className="w-5 h-5 text-purple-600" />
            </div>
            <h3 className="font-medium text-gray-700">Urun Tipleri</h3>
          </div>
          {loadingDistribution ? (
            <div className="h-8 bg-gray-200 rounded animate-pulse" />
          ) : (
            <p className="text-3xl font-bold">{Object.keys(itemTypeDistribution || {}).length}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Items by Status */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-gray-500" />
            Duruma Gore Urunler
          </h2>
          {loadingLifecycle ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-8 bg-gray-200 rounded animate-pulse" />
              ))}
            </div>
          ) : lifecycleReport?.itemsByStatus ? (
            <div className="space-y-3">
              {Object.entries(lifecycleReport.itemsByStatus).map(([status, count]) => {
                const total = lifecycleReport.totalItems || 1;
                const percentage = (count / total) * 100;
                return (
                  <div key={status}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-600">{status.replace(/_/g, ' ')}</span>
                      <span className="font-medium">{count} ({percentage.toFixed(1)}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">Veri mevcut degil</p>
          )}
        </div>

        {/* Items by Type */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <PieChart className="w-5 h-5 text-gray-500" />
            Tipe Gore Urunler
          </h2>
          {loadingDistribution ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-8 bg-gray-200 rounded animate-pulse" />
              ))}
            </div>
          ) : itemTypeDistribution ? (
            <div className="space-y-3">
              {Object.entries(itemTypeDistribution).map(([type, count]) => {
                const total = Object.values(itemTypeDistribution).reduce((a, b) => a + b, 0);
                const percentage = (count / total) * 100;
                const colors = ['bg-blue-600', 'bg-green-600', 'bg-purple-600', 'bg-orange-600', 'bg-cyan-600'];
                const colorIndex = Object.keys(itemTypeDistribution).indexOf(type) % colors.length;
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-600">{type}</span>
                      <span className="font-medium">{count} ({percentage.toFixed(1)}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`${colors[colorIndex]} h-2 rounded-full transition-all duration-500`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">Veri mevcut degil</p>
          )}
        </div>
      </div>

      {/* Workflow Progress */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-gray-500" />
          Is Akisi Ilerlemesi
        </h2>
        {loadingWorkflow ? (
          <div className="flex gap-4 justify-center">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
              <div key={i} className="w-16 h-16 bg-gray-200 rounded-full animate-pulse" />
            ))}
          </div>
        ) : workflowData ? (
          <div className="flex flex-wrap justify-center gap-8">
            {workflowData.map((step, index) => (
              <div key={step.status} className="text-center">
                <div className="relative">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-lg ${
                    step.count > 0 ? 'bg-blue-600' : 'bg-gray-300'
                  }`}>
                    {step.count}
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-gray-700 text-white rounded-full flex items-center justify-center text-xs">
                    {step.step}
                  </div>
                </div>
                <p className="text-xs text-gray-600 mt-2 max-w-[80px]">{step.name}</p>
                {index < workflowData.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 right-0 transform translate-x-full -translate-y-1/2">
                    <svg className="w-8 h-4 text-gray-300" fill="currentColor" viewBox="0 0 24 8">
                      <path d="M0 4h20l-4-4v3H0v2h16v3l4-4z" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-4">Is akisi verisi mevcut degil</p>
        )}
      </div>

      {/* Data Table */}
      {lifecycleReport?.itemsByStatus && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Detayli Durum Dagilimi</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-4 text-sm font-medium text-gray-500">Durum</th>
                  <th className="text-right py-2 px-4 text-sm font-medium text-gray-500">Sayi</th>
                  <th className="text-right py-2 px-4 text-sm font-medium text-gray-500">Yuzde</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(lifecycleReport.itemsByStatus).map(([status, count]) => {
                  const percentage = ((count / (lifecycleReport.totalItems || 1)) * 100).toFixed(1);
                  return (
                    <tr key={status} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-4">
                        <span className={`px-2 py-1 text-xs rounded status-${status}`}>
                          {status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-4 text-right font-medium">{count.toLocaleString()}</td>
                      <td className="py-2 px-4 text-right text-gray-500">{percentage}%</td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-50 font-bold">
                  <td className="py-2 px-4">Toplam</td>
                  <td className="py-2 px-4 text-right">{lifecycleReport.totalItems.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
