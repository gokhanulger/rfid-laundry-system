import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Download, Calendar, Package, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { waybillsApi } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Waybill } from '../lib/api';
import { jsPDF } from 'jspdf';

export function HotelIrsaliyePage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<string>('all'); // all, today, week, month
  const toast = useToast();

  // Get all waybills for this hotel (backend will filter by tenant)
  const { data: waybillsData, isLoading } = useQuery({
    queryKey: ['waybills'],
    queryFn: () => waybillsApi.getAll({ limit: 200 }),
  });

  const allWaybills = waybillsData?.data || [];

  // Filter by date
  const filterByDate = (waybill: Waybill) => {
    if (dateFilter === 'all') return true;

    const waybillDate = new Date(waybill.printedAt || waybill.createdAt);
    const now = new Date();

    if (dateFilter === 'today') {
      return waybillDate.toDateString() === now.toDateString();
    }
    if (dateFilter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return waybillDate >= weekAgo;
    }
    if (dateFilter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return waybillDate >= monthAgo;
    }
    return true;
  };

  // Filter by search
  const filterBySearch = (waybill: Waybill) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return waybill.waybillNumber.toLowerCase().includes(search);
  };

  const filteredWaybills = allWaybills.filter(w => filterByDate(w) && filterBySearch(w));

  // Group waybills by date
  const groupedByDate = filteredWaybills.reduce((acc, waybill) => {
    const date = new Date(waybill.printedAt || waybill.createdAt).toLocaleDateString('tr-TR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(waybill);
    return acc;
  }, {} as Record<string, Waybill[]>);

  // Parse item summary from waybill
  const getItemTotals = (waybill: Waybill) => {
    try {
      const parsed = JSON.parse(waybill.itemSummary || '[]');
      return parsed.map((item: any) => ({
        name: item.typeName || 'Bilinmeyen',
        count: item.count || 0,
      }));
    } catch {
      return [];
    }
  };

  // Download irsaliye as PDF
  const downloadPDF = (waybill: Waybill) => {
    const totals = getItemTotals(waybill);
    const documentNo = waybill.waybillNumber;
    const date = new Date(waybill.printedAt || waybill.createdAt).toLocaleDateString('tr-TR');

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPos = 20;

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('TEMIZ IRSALIYESI', pageWidth - margin, yPos, { align: 'right' });

    yPos += 10;

    // Hotel name
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Sayin:', margin, yPos);
    yPos += 5;
    doc.setFontSize(12);
    doc.text(waybill.tenant?.name || 'Otel', margin, yPos);

    // Document info on right
    const rightX = pageWidth - margin - 60;
    let rightY = 30;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Belge No:', rightX, rightY);
    doc.setFont('helvetica', 'normal');
    doc.text(documentNo, rightX + 30, rightY);
    rightY += 5;
    doc.setFont('helvetica', 'bold');
    doc.text('Tarih:', rightX, rightY);
    doc.setFont('helvetica', 'normal');
    doc.text(date, rightX + 30, rightY);

    yPos = Math.max(yPos, rightY) + 20;

    // Line
    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 8;

    // Table header
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('CINSI', margin, yPos);
    doc.text('MIKTARI', pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 3;
    doc.setLineWidth(0.3);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 7;

    // Items
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);

    totals.forEach((item: { name: string; count: number }) => {
      doc.text(item.name.toUpperCase(), margin, yPos);
      doc.text(item.count.toString() + ' adet', pageWidth - margin - 20, yPos, { align: 'right' });
      yPos += 8;
    });

    yPos += 10;

    // Totals
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('CUVAL SAYISI :', margin, yPos);
    doc.text((waybill.bagCount || 0).toString(), pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 8;

    doc.text('PAKET SAYISI :', margin, yPos);
    doc.text((waybill.packageCount || 0).toString(), pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 15;

    // Signature section
    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 15;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const sigWidth = (pageWidth - margin * 2) / 2;

    doc.text('Teslim Eden', margin + sigWidth / 2, yPos, { align: 'center' });
    doc.text('Teslim Alan', margin + sigWidth + sigWidth / 2, yPos, { align: 'center' });

    yPos += 20;

    doc.setLineWidth(0.3);
    doc.line(margin + 10, yPos, margin + sigWidth - 10, yPos);
    doc.line(margin + sigWidth + 10, yPos, pageWidth - margin - 10, yPos);

    // Footer
    yPos = doc.internal.pageSize.getHeight() - 15;
    doc.setFontSize(8);
    doc.text('RFID Camasirhane Sistemi', pageWidth / 2, yPos, { align: 'center' });

    const filename = `irsaliye-${documentNo}.pdf`;
    doc.save(filename);

    toast.success('Irsaliye indirildi!');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'delivered':
        return <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">Teslim Edildi</span>;
      case 'picked_up':
        return <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">Yolda</span>;
      case 'printed':
        return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">Bekliyor</span>;
      default:
        return <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">{status}</span>;
    }
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Stats
  const totalWaybills = allWaybills.length;
  const totalItems = allWaybills.reduce((sum, w) => sum + (w.totalItems || 0), 0);
  const thisMonthWaybills = allWaybills.filter(w => {
    const date = new Date(w.createdAt);
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-teal-100 rounded-lg">
          <FileText className="w-8 h-8 text-teal-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Irsaliyelerim</h1>
          <p className="text-gray-500">Size kesilen tum irsaliyeleri goruntuleyip indirebilirsiniz</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-100 rounded-lg">
              <FileText className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalWaybills}</p>
              <p className="text-sm text-gray-500">Toplam Irsaliye</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Package className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalItems}</p>
              <p className="text-sm text-gray-500">Toplam Urun</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Calendar className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{thisMonthWaybills}</p>
              <p className="text-sm text-gray-500">Bu Ay</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap gap-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Irsaliye no ile ara..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
          </div>

          {/* Date Filter */}
          <div className="flex gap-2">
            <button
              onClick={() => setDateFilter('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                dateFilter === 'all' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Tumu
            </button>
            <button
              onClick={() => setDateFilter('today')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                dateFilter === 'today' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Bugun
            </button>
            <button
              onClick={() => setDateFilter('week')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                dateFilter === 'week' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Bu Hafta
            </button>
            <button
              onClick={() => setDateFilter('month')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                dateFilter === 'month' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Bu Ay
            </button>
          </div>
        </div>
      </div>

      {/* Waybills List */}
      <div className="space-y-6">
        {isLoading ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
            <div className="animate-spin w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-500">Yukleniyor...</p>
          </div>
        ) : filteredWaybills.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
            <FileText className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <p className="text-xl text-gray-500">Irsaliye bulunamadi</p>
            <p className="text-gray-400 mt-2">
              {dateFilter !== 'all' ? 'Farkli bir tarih araligi secmeyi deneyin' : 'Henuz size kesilen irsaliye yok'}
            </p>
          </div>
        ) : (
          Object.entries(groupedByDate).map(([date, waybills]) => (
            <div key={date} className="space-y-3">
              {/* Date Header */}
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-teal-600" />
                <h2 className="text-lg font-semibold text-gray-800">{date}</h2>
                <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-sm font-medium">
                  {waybills.length} irsaliye
                </span>
              </div>

              {/* Waybills for this date */}
              <div className="space-y-2">
                {waybills.map((waybill) => {
                  const isExpanded = expandedId === waybill.id;
                  const itemTotals = getItemTotals(waybill);

                  return (
                    <div
                      key={waybill.id}
                      className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100"
                    >
                      {/* Main Row */}
                      <div
                        className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                        onClick={() => setExpandedId(isExpanded ? null : waybill.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="p-2 bg-teal-100 rounded-lg">
                            <FileText className="w-5 h-5 text-teal-600" />
                          </div>
                          <div>
                            <p className="font-mono font-bold text-gray-900">{waybill.waybillNumber}</p>
                            <div className="flex items-center gap-3 text-sm text-gray-500">
                              <span>{formatTime(waybill.printedAt || waybill.createdAt)}</span>
                              <span>|</span>
                              <span>{waybill.totalItems || 0} urun</span>
                              <span>|</span>
                              <span>{waybill.packageCount || 0} paket</span>
                              {waybill.bagCount > 0 && (
                                <>
                                  <span>|</span>
                                  <span>{waybill.bagCount} cuval</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {getStatusBadge(waybill.status)}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadPDF(waybill);
                            }}
                            className="p-2 text-teal-600 hover:bg-teal-50 rounded-lg"
                            title="PDF Indir"
                          >
                            <Download className="w-5 h-5" />
                          </button>
                          {isExpanded ? (
                            <ChevronUp className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="px-4 pb-4 border-t border-gray-100">
                          <div className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Item Summary */}
                            <div className="bg-gray-50 rounded-lg p-4">
                              <h4 className="font-semibold text-gray-700 mb-3">Urun Detayi</h4>
                              <div className="space-y-2">
                                {itemTotals.map((item: { name: string; count: number }, idx: number) => (
                                  <div key={idx} className="flex justify-between text-sm">
                                    <span className="text-gray-600">{item.name}</span>
                                    <span className="font-bold text-gray-900">{item.count} adet</span>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between font-bold">
                                <span>Toplam</span>
                                <span>{waybill.totalItems || 0} adet</span>
                              </div>
                            </div>

                            {/* Waybill Info */}
                            <div className="bg-gray-50 rounded-lg p-4">
                              <h4 className="font-semibold text-gray-700 mb-3">Irsaliye Bilgileri</h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Belge No:</span>
                                  <span className="font-mono font-medium">{waybill.waybillNumber}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Paket Sayisi:</span>
                                  <span className="font-medium">{waybill.packageCount || 0}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Cuval Sayisi:</span>
                                  <span className="font-medium">{waybill.bagCount || 0}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Durum:</span>
                                  {getStatusBadge(waybill.status)}
                                </div>
                                {waybill.deliveredAt && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Teslim Tarihi:</span>
                                    <span className="font-medium">
                                      {new Date(waybill.deliveredAt).toLocaleString('tr-TR')}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Download Button */}
                          <div className="mt-4 flex justify-end">
                            <button
                              onClick={() => downloadPDF(waybill)}
                              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                            >
                              <Download className="w-4 h-4" />
                              Irsaliye Indir (PDF)
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
