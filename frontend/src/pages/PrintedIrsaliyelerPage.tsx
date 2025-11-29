import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, RefreshCw, Eye, Printer, Search, Calendar, Building2, Package, X } from 'lucide-react';
import { deliveriesApi, settingsApi } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Delivery } from '../types';
import { jsPDF } from 'jspdf';

export function PrintedIrsaliyelerPage() {
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHotelFilter, setSelectedHotelFilter] = useState<string>('');
  const toast = useToast();

  // Get tenants for filtering
  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  // Get printed deliveries (label_printed status)
  const { data: printedDeliveries, isLoading, refetch } = useQuery({
    queryKey: ['deliveries', { status: 'label_printed' }],
    queryFn: () => deliveriesApi.getAll({ status: 'label_printed', limit: 100 }),
  });

  // Also get picked_up deliveries (delivered)
  const { data: pickedUpDeliveries } = useQuery({
    queryKey: ['deliveries', { status: 'picked_up' }],
    queryFn: () => deliveriesApi.getAll({ status: 'picked_up', limit: 100 }),
  });

  // Combine both lists
  const allDeliveries = [
    ...(printedDeliveries?.data || []),
    ...(pickedUpDeliveries?.data || []),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Filter deliveries
  const filteredDeliveries = allDeliveries.filter(delivery => {
    const matchesSearch = searchTerm === '' ||
      delivery.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      delivery.tenant?.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesHotel = selectedHotelFilter === '' || delivery.tenantId === selectedHotelFilter;
    return matchesSearch && matchesHotel;
  });

  // Group items by type for a delivery
  const getItemTotals = (delivery: Delivery) => {
    const totals: Record<string, { name: string; count: number }> = {};

    delivery.deliveryItems?.forEach((di: any) => {
      const typeName = di.item?.itemType?.name || 'Bilinmeyen';
      const typeId = di.item?.itemTypeId || 'unknown';

      if (!totals[typeId]) {
        totals[typeId] = { name: typeName, count: 0 };
      }
      totals[typeId].count++;
    });

    return Object.values(totals);
  };

  // Regenerate and print irsaliye PDF
  const handleReprintIrsaliye = (delivery: Delivery) => {
    const hotel = tenants?.find(t => t.id === delivery.tenantId);
    const totals = getItemTotals(delivery);
    const documentNo = `A-${delivery.barcode.slice(-9)}`;
    const date = new Date(delivery.labelPrintedAt || delivery.createdAt).toLocaleDateString('tr-TR');

    // Create PDF - A4 size
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPos = 20;

    // Header - Document Type
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('TEMIZ IRSALIYESI', pageWidth - margin, yPos, { align: 'right' });

    yPos += 10;

    // Hotel Info (left side)
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Sayin:', margin, yPos);
    yPos += 5;
    doc.setFontSize(12);
    doc.text(hotel?.name || delivery.tenant?.name || 'Bilinmeyen Otel', margin, yPos);
    yPos += 5;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    if (hotel?.address) {
      const addressLines = hotel.address.split('\n');
      addressLines.forEach(line => {
        doc.text(line, margin, yPos);
        yPos += 4;
      });
    }

    // Document Info (right side)
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

    yPos = Math.max(yPos, rightY) + 15;

    // Separator line
    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 8;

    // Table Header
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('CINSI', margin, yPos);
    doc.text('MIKTARI', pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 3;
    doc.setLineWidth(0.3);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 7;

    // Item rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);

    totals.forEach(item => {
      doc.text(item.name.toUpperCase(), margin, yPos);
      doc.text(item.count.toString(), pageWidth - margin - 20, yPos, { align: 'right' });
      yPos += 8;
    });

    yPos += 10;

    // Package count - big and bold
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('PAKET SAYISI :', margin, yPos);
    doc.text((delivery.packageCount || 1).toString(), pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 5;

    // Total items
    const totalItems = delivery.deliveryItems?.length || 0;
    doc.setFontSize(12);
    doc.text('TOPLAM URUN :', margin, yPos);
    doc.text(totalItems.toString(), pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 20;

    // Barcode reference
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Barkod: ${delivery.barcode}`, margin, yPos);

    yPos += 15;

    // Separator line
    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 15;

    // Signature section
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const sigWidth = (pageWidth - margin * 2) / 2;

    doc.text('Teslim Eden', margin + sigWidth / 2, yPos, { align: 'center' });
    doc.text('Teslim Alan', margin + sigWidth + sigWidth / 2, yPos, { align: 'center' });

    yPos += 20;

    // Signature lines
    doc.setLineWidth(0.3);
    doc.line(margin + 10, yPos, margin + sigWidth - 10, yPos);
    doc.line(margin + sigWidth + 10, yPos, pageWidth - margin - 10, yPos);

    // Footer
    yPos = doc.internal.pageSize.getHeight() - 15;
    doc.setFontSize(8);
    doc.text('RFID Camasirhane Sistemi', pageWidth / 2, yPos, { align: 'center' });

    // Save
    const filename = `irsaliye-${hotel?.name?.replace(/\s+/g, '-') || 'otel'}-${documentNo}.pdf`;
    doc.save(filename);

    toast.success('Irsaliye yeniden yazdirildi!');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'label_printed':
        return <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">Etiket Basildi</span>;
      case 'picked_up':
        return <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">Teslim Edildi</span>;
      default:
        return <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">{status}</span>;
    }
  };

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-lg">
            <FileText className="w-8 h-8 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Basilan Irsaliyeler</h1>
            <p className="text-gray-500">Gecmis irsaliyeleri goruntuleyin ve yeniden yazdirin</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <RefreshCw className="w-4 h-4" />
          Yenile
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-lg p-4 flex flex-wrap gap-4">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Barkod veya otel ara..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Hotel Filter */}
        <div className="min-w-[200px]">
          <select
            value={selectedHotelFilter}
            onChange={(e) => setSelectedHotelFilter(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Tum Oteller</option>
            {tenants?.map(tenant => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-indigo-600">{allDeliveries.length}</p>
          <p className="text-sm text-gray-500">Toplam Irsaliye</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-blue-600">{printedDeliveries?.data?.length || 0}</p>
          <p className="text-sm text-gray-500">Bekleyen</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-3xl font-bold text-green-600">{pickedUpDeliveries?.data?.length || 0}</p>
          <p className="text-sm text-gray-500">Teslim Edildi</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Delivery List */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="p-4 border-b bg-indigo-50">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Package className="w-5 h-5 text-indigo-600" />
              Irsaliye Listesi ({filteredDeliveries.length})
            </h2>
          </div>

          {isLoading ? (
            <div className="p-12 text-center">
              <RefreshCw className="w-10 h-10 animate-spin text-indigo-500 mx-auto" />
            </div>
          ) : filteredDeliveries.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-xl text-gray-500">Irsaliye bulunamadi</p>
              <p className="text-gray-400 mt-2">Filtreleri degistirmeyi deneyin</p>
            </div>
          ) : (
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {filteredDeliveries.map(delivery => (
                <div
                  key={delivery.id}
                  className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
                    selectedDelivery?.id === delivery.id ? 'bg-indigo-50 border-l-4 border-indigo-500' : ''
                  }`}
                  onClick={() => setSelectedDelivery(delivery)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-lg">{delivery.barcode}</span>
                    {getStatusBadge(delivery.status)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                    <Building2 className="w-4 h-4" />
                    <span className="font-medium">{delivery.tenant?.name}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span>{formatDate(delivery.labelPrintedAt || delivery.createdAt)}</span>
                    </div>
                    <span>{delivery.deliveryItems?.length || 0} urun, {delivery.packageCount || 1} paket</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview Panel */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Eye className="w-5 h-5 text-gray-600" />
              Onizleme
            </h2>
            {selectedDelivery && (
              <button
                onClick={() => setSelectedDelivery(null)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {!selectedDelivery ? (
            <div className="p-12 text-center">
              <Eye className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">Onizleme icin bir irsaliye secin</p>
            </div>
          ) : (
            <div className="p-4">
              {/* Preview Header */}
              <div className="text-center mb-4 pb-4 border-b">
                <h3 className="text-xl font-bold text-gray-900">TEMIZ IRSALIYESI</h3>
                <p className="text-sm text-gray-500 mt-1">Belge No: A-{selectedDelivery.barcode.slice(-9)}</p>
              </div>

              {/* Hotel Info */}
              <div className="mb-4">
                <p className="text-sm text-gray-500">Sayin:</p>
                <p className="text-lg font-bold text-gray-900">{selectedDelivery.tenant?.name}</p>
              </div>

              {/* Date */}
              <div className="mb-4">
                <p className="text-sm text-gray-500">Tarih:</p>
                <p className="font-medium">{formatDate(selectedDelivery.labelPrintedAt || selectedDelivery.createdAt)}</p>
              </div>

              {/* Items */}
              <div className="mb-4">
                <p className="text-sm text-gray-500 mb-2">Urunler:</p>
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  {getItemTotals(selectedDelivery).map((item, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span>{item.name}</span>
                      <span className="font-bold">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="bg-indigo-50 rounded-lg p-4 mb-4">
                <div className="flex justify-between mb-2">
                  <span className="font-medium">Toplam Urun:</span>
                  <span className="font-bold text-indigo-600">{selectedDelivery.deliveryItems?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Paket Sayisi:</span>
                  <span className="font-bold text-indigo-600">{selectedDelivery.packageCount || 1}</span>
                </div>
              </div>

              {/* Barcode */}
              <div className="text-center mb-4 p-3 bg-gray-100 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Barkod</p>
                <p className="font-mono font-bold text-lg">{selectedDelivery.barcode}</p>
              </div>

              {/* Status */}
              <div className="text-center mb-4">
                {getStatusBadge(selectedDelivery.status)}
              </div>

              {/* Reprint Button */}
              <button
                onClick={() => handleReprintIrsaliye(selectedDelivery)}
                className="w-full py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold flex items-center justify-center gap-2"
              >
                <Printer className="w-5 h-5" />
                YENIDEN YAZDIR
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
