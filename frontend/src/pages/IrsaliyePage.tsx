import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, QrCode, Printer, RefreshCw, CheckCircle, Package, X, Trash2, History, Search, Building2 } from 'lucide-react';
import { deliveriesApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Delivery, DeliveryPackage } from '../types';
import { jsPDF } from 'jspdf';

interface ScannedPackage {
  delivery: Delivery;
  pkg: DeliveryPackage;
}

interface ItemTypeSummary {
  name: string;
  count: number;
}

interface HotelPackageStatus {
  id: string;
  name: string;
  packagedCount: number;
  deliveries: Delivery[];
  itemSummary: ItemTypeSummary[];
  totalItems: number;
}

type TabType = 'create' | 'history';

export function IrsaliyePage() {
  const [activeTab, setActiveTab] = useState<TabType>('create');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedPackages, setScannedPackages] = useState<ScannedPackage[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
  const [showHotelDetail, setShowHotelDetail] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  // History tab state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHotelFilter, setSelectedHotelFilter] = useState<string>('');
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null);

  // Get tenants for hotel selection
  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: settingsApi.getTenants,
  });

  // Get packaged deliveries ready for irsaliye
  const { data: packagedDeliveries, isLoading, refetch } = useQuery({
    queryKey: ['deliveries', { status: 'packaged' }],
    queryFn: () => deliveriesApi.getAll({ status: 'packaged', limit: 100 }),
  });

  // Get printed deliveries (label_printed status)
  const { data: printedDeliveries, refetch: refetchPrinted } = useQuery({
    queryKey: ['deliveries', { status: 'label_printed' }],
    queryFn: () => deliveriesApi.getAll({ status: 'label_printed', limit: 100 }),
  });

  // Get picked_up deliveries (delivered)
  const { data: pickedUpDeliveries } = useQuery({
    queryKey: ['deliveries', { status: 'picked_up' }],
    queryFn: () => deliveriesApi.getAll({ status: 'picked_up', limit: 100 }),
  });

  const scanMutation = useMutation({
    mutationFn: async (barcode: string) => {
      const delivery = await deliveriesApi.getByBarcode(barcode.replace(/-PKG\d+$/, ''));
      return { delivery, barcode };
    },
    onSuccess: ({ delivery, barcode }) => {
      if (delivery.status !== 'packaged') {
        toast.warning(`Bu teslimat henuz paketlenmedi (durum: ${delivery.status})`);
        setBarcodeInput('');
        return;
      }

      if (selectedHotelId && delivery.tenantId !== selectedHotelId) {
        toast.error('Bu paket farkli bir otele ait!');
        setBarcodeInput('');
        return;
      }

      let pkg: DeliveryPackage | undefined;
      if (barcode.includes('-PKG')) {
        pkg = delivery.deliveryPackages?.find(p => p.packageBarcode === barcode);
      } else {
        pkg = delivery.deliveryPackages?.[0];
      }

      if (!pkg) {
        pkg = {
          id: `virtual-${delivery.id}`,
          deliveryId: delivery.id,
          packageBarcode: delivery.barcode,
          sequenceNumber: 1,
          status: 'created',
          scannedAt: null,
          scannedBy: null,
          pickedUpAt: null,
          createdAt: delivery.createdAt,
        };
      }

      const alreadyScanned = scannedPackages.some(
        sp => sp.pkg.packageBarcode === pkg!.packageBarcode
      );
      if (alreadyScanned) {
        toast.warning('Bu paket zaten taranmis!');
        setBarcodeInput('');
        return;
      }

      if (!selectedHotelId) {
        setSelectedHotelId(delivery.tenantId);
      }

      setScannedPackages(prev => [...prev, { delivery, pkg: pkg! }]);
      toast.success(`Paket eklendi: ${pkg!.packageBarcode}`);
      setBarcodeInput('');
      inputRef.current?.focus();
    },
    onError: (err) => {
      toast.error('Paket bulunamadi', getErrorMessage(err));
      setBarcodeInput('');
    },
  });

  const handleScan = () => {
    if (!barcodeInput.trim()) return;
    scanMutation.mutate(barcodeInput.trim().toUpperCase());
  };

  const handleRemovePackage = (index: number) => {
    setScannedPackages(prev => {
      const newPackages = prev.filter((_, i) => i !== index);
      if (newPackages.length === 0) {
        setSelectedHotelId(null);
      }
      return newPackages;
    });
  };

  const handleClearAll = () => {
    setScannedPackages([]);
    setSelectedHotelId(null);
  };

  const calculateTotals = () => {
    const totals: Record<string, { name: string; count: number }> = {};

    scannedPackages.forEach(({ delivery }) => {
      delivery.deliveryItems?.forEach((di: any) => {
        const typeName = di.item?.itemType?.name || 'Bilinmeyen';
        const typeId = di.item?.itemTypeId || 'unknown';

        if (!totals[typeId]) {
          totals[typeId] = { name: typeName, count: 0 };
        }
        totals[typeId].count++;
      });
    });

    return Object.values(totals);
  };

  // Get item totals for a specific delivery
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

  const generateIrsaliyePDF = () => {
    if (scannedPackages.length === 0) {
      toast.error('Lutfen once paketleri tarayin');
      return;
    }

    const hotel = tenants?.find(t => t.id === selectedHotelId);
    const totals = calculateTotals();
    const documentNo = `A-${Date.now().toString().slice(-9)}`;
    const today = new Date().toLocaleDateString('tr-TR');

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPos = 20;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('TEMIZ IRSALIYESI', pageWidth - margin, yPos, { align: 'right' });

    yPos += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Sayin:', margin, yPos);
    yPos += 5;
    doc.setFontSize(12);
    doc.text(hotel?.name || 'Bilinmeyen Otel', margin, yPos);
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

    const rightX = pageWidth - margin - 60;
    let rightY = 30;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Tarih:', rightX, rightY);
    doc.setFont('helvetica', 'normal');
    doc.text(documentNo, rightX + 30, rightY);
    rightY += 5;
    doc.text(today, rightX + 30, rightY);
    rightY += 5;
    doc.text(today, rightX + 30, rightY);

    yPos = Math.max(yPos, rightY) + 10;

    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 5;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('CINSI', margin, yPos);
    doc.text('MIKTARI', pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 3;
    doc.setLineWidth(0.3);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);

    totals.forEach(item => {
      doc.text(item.name.toUpperCase(), margin, yPos);
      doc.text(item.count.toString(), pageWidth - margin - 20, yPos, { align: 'right' });
      yPos += 8;
    });

    yPos += 10;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('PAKET SAYISI :', margin, yPos);
    doc.text(scannedPackages.length.toString(), pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 20;

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

    yPos = doc.internal.pageSize.getHeight() - 15;
    doc.setFontSize(8);
    doc.text('RFID Camasirhane Sistemi', pageWidth / 2, yPos, { align: 'center' });

    const filename = `irsaliye-${hotel?.name?.replace(/\s+/g, '-') || 'otel'}-${documentNo}.pdf`;
    doc.save(filename);

    toast.success('Irsaliye olusturuldu!');

    scannedPackages.forEach(({ delivery }) => {
      deliveriesApi.pickup(delivery.id).catch(() => {});
    });

    setTimeout(() => {
      handleClearAll();
      setShowHotelDetail(false);
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      refetchPrinted();
    }, 1000);
  };

  // Reprint irsaliye for a past delivery
  const handleReprintIrsaliye = (delivery: Delivery) => {
    const hotel = tenants?.find(t => t.id === delivery.tenantId);
    const totals = getItemTotals(delivery);
    const documentNo = `A-${delivery.barcode.slice(-9)}`;
    const date = new Date(delivery.labelPrintedAt || delivery.createdAt).toLocaleDateString('tr-TR');

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPos = 20;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('TEMIZ IRSALIYESI', pageWidth - margin, yPos, { align: 'right' });

    yPos += 10;

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

    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('CINSI', margin, yPos);
    doc.text('MIKTARI', pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 3;
    doc.setLineWidth(0.3);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);

    totals.forEach(item => {
      doc.text(item.name.toUpperCase(), margin, yPos);
      doc.text(item.count.toString(), pageWidth - margin - 20, yPos, { align: 'right' });
      yPos += 8;
    });

    yPos += 10;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('PAKET SAYISI :', margin, yPos);
    doc.text((delivery.packageCount || 1).toString(), pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 5;

    const totalItems = delivery.deliveryItems?.length || 0;
    doc.setFontSize(12);
    doc.text('TOPLAM URUN :', margin, yPos);
    doc.text(totalItems.toString(), pageWidth - margin - 20, yPos, { align: 'right' });

    yPos += 20;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Barkod: ${delivery.barcode}`, margin, yPos);

    yPos += 15;

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

    yPos = doc.internal.pageSize.getHeight() - 15;
    doc.setFontSize(8);
    doc.text('RFID Camasirhane Sistemi', pageWidth / 2, yPos, { align: 'center' });

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

  const selectedHotel = tenants?.find(t => t.id === selectedHotelId);
  const totals = calculateTotals();
  const packagedList = packagedDeliveries?.data || [];

  // Group packaged deliveries by hotel with item summary
  const hotelPackageStatuses: HotelPackageStatus[] = (tenants || []).map(tenant => {
    const hotelDeliveries = packagedList.filter((d: Delivery) => d.tenantId === tenant.id);

    // Calculate item summary for this hotel
    const itemTotals: Record<string, { name: string; count: number }> = {};
    let totalItems = 0;

    hotelDeliveries.forEach((delivery: Delivery) => {
      // Try to get items from notes (labelExtraData stored as JSON)
      if (delivery.notes) {
        try {
          const labelData = JSON.parse(delivery.notes);
          if (Array.isArray(labelData)) {
            labelData.forEach((item: any) => {
              const typeName = item.typeName || 'Bilinmeyen';
              const count = item.count || 0;
              if (!itemTotals[typeName]) {
                itemTotals[typeName] = { name: typeName, count: 0 };
              }
              itemTotals[typeName].count += count;
              totalItems += count;
            });
            return;
          }
        } catch {}
      }

      // Fallback to deliveryItems
      delivery.deliveryItems?.forEach((di: any) => {
        const typeName = di.item?.itemType?.name || 'Bilinmeyen';
        if (!itemTotals[typeName]) {
          itemTotals[typeName] = { name: typeName, count: 0 };
        }
        itemTotals[typeName].count++;
        totalItems++;
      });
    });

    return {
      id: tenant.id,
      name: tenant.name,
      packagedCount: hotelDeliveries.length,
      deliveries: hotelDeliveries,
      itemSummary: Object.values(itemTotals),
      totalItems,
    };
  }).filter(h => h.packagedCount > 0);

  // Combine printed and picked up deliveries for history
  const allDeliveries = [
    ...(printedDeliveries?.data || []),
    ...(pickedUpDeliveries?.data || []),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Filter deliveries for history
  const filteredDeliveries = allDeliveries.filter(delivery => {
    const matchesSearch = searchTerm === '' ||
      delivery.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      delivery.tenant?.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesHotel = selectedHotelFilter === '' || delivery.tenantId === selectedHotelFilter;
    return matchesSearch && matchesHotel;
  });

  const handleRefresh = () => {
    refetch();
    refetchPrinted();
  };

  // Handle hotel card click
  const handleHotelClick = (hotelId: string) => {
    setSelectedHotelId(hotelId);
    setShowHotelDetail(true);
    setScannedPackages([]);
  };

  // Get selected hotel's deliveries
  const selectedHotelDeliveries = packagedList.filter((d: Delivery) => d.tenantId === selectedHotelId);

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-100 rounded-lg">
            <FileText className="w-8 h-8 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Irsaliye</h1>
            <p className="text-gray-500">Otel bazli paket yonetimi</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <RefreshCw className="w-4 h-4" />
          Yenile
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 px-6 py-4 text-center font-medium transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'create'
                ? 'bg-teal-50 text-teal-700 border-b-2 border-teal-600'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            <QrCode className="w-5 h-5" />
            Yeni Irsaliye
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 px-6 py-4 text-center font-medium transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'history'
                ? 'bg-teal-50 text-teal-700 border-b-2 border-teal-600'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            <History className="w-5 h-5" />
            Basilan Irsaliyeler
            {allDeliveries.length > 0 && (
              <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-bold">
                {allDeliveries.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'create' ? (
            /* CREATE TAB - Hotel Grid View */
            <div className="space-y-6">
              {/* Legend */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-6">
                  <span className="text-sm font-medium text-gray-700">Durum:</span>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-yellow-400 border-2 border-yellow-500 rounded"></div>
                    <span className="text-sm text-gray-600">Paketlendi - Irsaliye Bekliyor</span>
                  </div>
                </div>
              </div>

              {/* Hotel Grid */}
              {isLoading ? (
                <div className="flex items-center justify-center h-64">
                  <RefreshCw className="w-8 h-8 animate-spin text-teal-500" />
                </div>
              ) : hotelPackageStatuses.length === 0 ? (
                <div className="p-16 text-center bg-gray-50 rounded-xl">
                  <Package className="w-20 h-20 mx-auto text-gray-300 mb-4" />
                  <p className="text-2xl font-semibold text-gray-500">Paketlenmis teslimat yok</p>
                  <p className="text-lg text-gray-400 mt-2">Tum paketler teslim edilmis</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {hotelPackageStatuses.map((hotel) => (
                      <button
                        key={hotel.id}
                        onClick={() => handleHotelClick(hotel.id)}
                        className="
                          relative rounded-xl border-2 p-4
                          bg-yellow-400 border-yellow-500 text-yellow-900
                          hover:scale-[1.02] hover:shadow-lg transition-all duration-200
                          flex flex-col items-start
                          cursor-pointer text-left
                        "
                        title={hotel.name}
                      >
                        {/* Header */}
                        <div className="flex items-center gap-2 mb-3 w-full">
                          <Building2 className="w-6 h-6 opacity-75 flex-shrink-0" />
                          <span className="font-bold text-lg leading-tight line-clamp-1 flex-1">
                            {hotel.name}
                          </span>
                          <span className="w-8 h-8 bg-teal-600 text-white text-sm rounded-full flex items-center justify-center font-bold shadow-md flex-shrink-0">
                            {hotel.packagedCount}
                          </span>
                        </div>

                        {/* Item Summary */}
                        <div className="w-full space-y-1 bg-yellow-300/50 rounded-lg p-2 mb-2">
                          {hotel.itemSummary.length > 0 ? (
                            hotel.itemSummary.slice(0, 4).map((item, idx) => (
                              <div key={idx} className="flex justify-between text-sm">
                                <span className="truncate">{item.name}</span>
                                <span className="font-bold ml-2">{item.count} adet</span>
                              </div>
                            ))
                          ) : (
                            <div className="text-sm text-yellow-700 italic">Icerik bilgisi yok</div>
                          )}
                          {hotel.itemSummary.length > 4 && (
                            <div className="text-xs text-yellow-700 mt-1">
                              +{hotel.itemSummary.length - 4} tur daha...
                            </div>
                          )}
                        </div>

                        {/* Footer Stats */}
                        <div className="flex justify-between w-full text-xs text-yellow-800">
                          <span>{hotel.packagedCount} paket</span>
                          <span className="font-bold">{hotel.totalItems} urun</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-3xl font-bold text-teal-600">{hotelPackageStatuses.length}</p>
                  <p className="text-sm text-gray-500">Paketli Otel</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-3xl font-bold text-yellow-600">{packagedList.length}</p>
                  <p className="text-sm text-gray-500">Toplam Paket</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-3xl font-bold text-green-600">{allDeliveries.length}</p>
                  <p className="text-sm text-gray-500">Basilan Irsaliye</p>
                </div>
              </div>
            </div>
          ) : (
            /* HISTORY TAB */
            <div className="space-y-6">
              {/* Filters */}
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Barkod veya otel ara..."
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    />
                  </div>
                </div>

                <div className="min-w-[200px]">
                  <select
                    value={selectedHotelFilter}
                    onChange={(e) => setSelectedHotelFilter(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
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
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-3xl font-bold text-teal-600">{allDeliveries.length}</p>
                  <p className="text-sm text-gray-500">Toplam Irsaliye</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-3xl font-bold text-blue-600">{printedDeliveries?.data?.length || 0}</p>
                  <p className="text-sm text-gray-500">Bekleyen</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-3xl font-bold text-green-600">{pickedUpDeliveries?.data?.length || 0}</p>
                  <p className="text-sm text-gray-500">Teslim Edildi</p>
                </div>
              </div>

              {/* Main Content - List on left, Preview on right */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Deliveries List */}
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {filteredDeliveries.length === 0 ? (
                    <div className="p-12 text-center bg-gray-50 rounded-xl">
                      <FileText className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                      <p className="text-xl text-gray-500">Irsaliye bulunamadi</p>
                      <p className="text-gray-400 mt-2">Filtreleri degistirmeyi deneyin</p>
                    </div>
                  ) : (
                    filteredDeliveries.map(delivery => {
                      const isSelected = expandedDeliveryId === delivery.id;

                      return (
                        <div
                          key={delivery.id}
                          className={`bg-white border rounded-xl overflow-hidden cursor-pointer transition-all ${
                            isSelected ? 'border-teal-500 ring-2 ring-teal-200' : 'hover:border-gray-300'
                          }`}
                          onClick={() => setExpandedDeliveryId(isSelected ? null : delivery.id)}
                        >
                          <div className="p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${isSelected ? 'bg-teal-500 text-white' : 'bg-gray-100'}`}>
                                  <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="font-mono font-bold">{delivery.barcode}</p>
                                  <div className="flex items-center gap-2 text-sm text-gray-500">
                                    <Building2 className="w-3 h-3" />
                                    <span>{delivery.tenant?.name}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-gray-500">{formatDate(delivery.labelPrintedAt || delivery.createdAt)}</p>
                                <div className="mt-1">{getStatusBadge(delivery.status)}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Preview Panel - Right Side */}
                <div className="bg-gray-100 rounded-xl p-6 sticky top-0">
                  {!expandedDeliveryId ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 py-20">
                      <FileText className="w-20 h-20 mb-4" />
                      <p className="text-lg">Onizleme icin bir irsaliye secin</p>
                    </div>
                  ) : (
                    (() => {
                      const selectedDelivery = filteredDeliveries.find(d => d.id === expandedDeliveryId);
                      if (!selectedDelivery) return null;
                      const itemTotals = getItemTotals(selectedDelivery);

                      return (
                        <div className="space-y-4">
                          {/* Document Preview */}
                          <div className="bg-white rounded-lg shadow-lg p-6 border" style={{ fontFamily: 'serif' }}>
                            {/* Document Header */}
                            <div className="flex justify-between items-start mb-4 pb-2 border-b-2 border-gray-800">
                              <div>
                                <p className="text-xs text-gray-500">Sayin:</p>
                                <p className="text-lg font-bold">{selectedDelivery.tenant?.name}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold">TEMIZ IRSALIYESI</p>
                              </div>
                            </div>

                            {/* Document Info */}
                            <div className="flex justify-between text-sm mb-4">
                              <div>
                                <p className="text-gray-500">Belge No:</p>
                                <p className="font-mono font-bold">A-{selectedDelivery.barcode.slice(-9)}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-gray-500">Tarih:</p>
                                <p className="font-medium">{new Date(selectedDelivery.labelPrintedAt || selectedDelivery.createdAt).toLocaleDateString('tr-TR')}</p>
                              </div>
                            </div>

                            {/* Items Table */}
                            <div className="border-t border-b border-gray-300 py-2 mb-4">
                              <div className="flex justify-between font-bold text-sm border-b border-gray-200 pb-1 mb-2">
                                <span>CINSI</span>
                                <span>MIKTARI</span>
                              </div>
                              {itemTotals.map((item, idx) => (
                                <div key={idx} className="flex justify-between text-sm py-1">
                                  <span>{item.name.toUpperCase()}</span>
                                  <span className="font-bold">{item.count} adet</span>
                                </div>
                              ))}
                            </div>

                            {/* Totals */}
                            <div className="space-y-2 mb-4">
                              <div className="flex justify-between font-bold text-lg">
                                <span>PAKET SAYISI:</span>
                                <span>{selectedDelivery.packageCount || 1}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span>TOPLAM URUN:</span>
                                <span className="font-bold">{selectedDelivery.deliveryItems?.length || 0}</span>
                              </div>
                            </div>

                            {/* Barcode */}
                            <div className="text-center py-2 bg-gray-50 rounded text-xs text-gray-500 mb-4">
                              Barkod: {selectedDelivery.barcode}
                            </div>

                            {/* Signature Section */}
                            <div className="border-t border-gray-300 pt-4">
                              <div className="flex justify-between">
                                <div className="text-center flex-1">
                                  <p className="text-xs text-gray-500 mb-6">Teslim Eden</p>
                                  <div className="border-t border-gray-400 w-24 mx-auto"></div>
                                </div>
                                <div className="text-center flex-1">
                                  <p className="text-xs text-gray-500 mb-6">Teslim Alan</p>
                                  <div className="border-t border-gray-400 w-24 mx-auto"></div>
                                </div>
                              </div>
                            </div>

                            {/* Footer */}
                            <div className="text-center text-xs text-gray-400 mt-4 pt-2 border-t">
                              RFID Camasirhane Sistemi
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex gap-3">
                            <div className="flex-1 bg-white rounded-lg p-3 shadow flex items-center gap-3">
                              {getStatusBadge(selectedDelivery.status)}
                              <span className="text-sm text-gray-500">
                                {selectedDelivery.status === 'picked_up' ? 'Teslim edildi' : 'Bekliyor'}
                              </span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReprintIrsaliye(selectedDelivery);
                              }}
                              className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium flex items-center gap-2 shadow"
                            >
                              <Printer className="w-5 h-5" />
                              Yazdir
                            </button>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hotel Detail Modal */}
      {showHotelDetail && selectedHotelId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => { setShowHotelDetail(false); handleClearAll(); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-teal-600 to-teal-500 p-6 rounded-t-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Building2 className="w-10 h-10 text-white" />
                  <div>
                    <h2 className="text-2xl font-bold text-white">{selectedHotel?.name}</h2>
                    <p className="text-teal-100">{selectedHotelDeliveries.length} paket hazir</p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowHotelDetail(false); handleClearAll(); }}
                  className="p-2 text-white hover:bg-white/20 rounded-lg"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Scanner and Scanned Packages */}
                <div className="space-y-4">
                  {/* Scanner Section */}
                  <div className="bg-teal-50 rounded-xl p-4 border-2 border-teal-200">
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <QrCode className="w-5 h-5 text-teal-600" />
                      Paket Barkodunu Tarayin
                    </h3>
                    <div className="flex gap-3">
                      <input
                        ref={inputRef}
                        type="text"
                        value={barcodeInput}
                        onChange={(e) => setBarcodeInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                        placeholder="Paket barkodunu tarayin..."
                        className="flex-1 px-4 py-3 text-lg border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono"
                        autoFocus
                      />
                      <button
                        onClick={handleScan}
                        disabled={scanMutation.isPending || !barcodeInput.trim()}
                        className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                      >
                        {scanMutation.isPending ? 'Araniyor...' : 'Ekle'}
                      </button>
                    </div>
                  </div>

                  {/* Scanned Packages */}
                  <div className="bg-white rounded-xl border overflow-hidden">
                    <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                      <h3 className="font-semibold flex items-center gap-2">
                        <Package className="w-5 h-5 text-teal-600" />
                        Taranan Paketler ({scannedPackages.length})
                      </h3>
                      {scannedPackages.length > 0 && (
                        <button
                          onClick={handleClearAll}
                          className="text-sm text-red-600 hover:text-red-800 flex items-center gap-1"
                        >
                          <Trash2 className="w-4 h-4" />
                          Temizle
                        </button>
                      )}
                    </div>

                    {scannedPackages.length === 0 ? (
                      <div className="p-8 text-center">
                        <QrCode className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                        <p className="text-gray-500">Henuz paket taranmadi</p>
                        <p className="text-gray-400 text-sm mt-1">Sagdaki listeden secin veya barkod tarayin</p>
                      </div>
                    ) : (
                      <div className="divide-y max-h-[250px] overflow-y-auto">
                        {scannedPackages.map((sp, index) => (
                          <div key={sp.pkg.packageBarcode} className="p-3 flex items-center justify-between hover:bg-gray-50">
                            <div className="flex items-center gap-3">
                              <span className="w-7 h-7 flex items-center justify-center bg-teal-100 text-teal-700 rounded-full font-bold text-sm">
                                {index + 1}
                              </span>
                              <div>
                                <p className="font-mono font-medium">{sp.pkg.packageBarcode}</p>
                                <p className="text-xs text-gray-500">{sp.delivery.deliveryItems?.length || 0} urun</p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleRemovePackage(index)}
                              className="p-1 text-red-500 hover:bg-red-50 rounded"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Summary and Print Button */}
                  {totals.length > 0 && (
                    <div className="bg-white rounded-xl border p-4">
                      <h3 className="font-semibold mb-3">Urun Ozeti</h3>
                      <div className="space-y-2 mb-4">
                        {totals.map((item, index) => (
                          <div key={index} className="flex items-center justify-between py-1 border-b last:border-0">
                            <span className="text-sm">{item.name}</span>
                            <span className="font-bold text-teal-600">{item.count} adet</span>
                          </div>
                        ))}
                      </div>
                      <div className="pt-3 border-t flex items-center justify-between">
                        <span className="font-bold">PAKET SAYISI</span>
                        <span className="text-xl font-bold text-teal-700">{scannedPackages.length}</span>
                      </div>
                    </div>
                  )}

                  {scannedPackages.length > 0 && (
                    <button
                      onClick={generateIrsaliyePDF}
                      className="w-full py-4 bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-bold text-lg flex items-center justify-center gap-3 shadow-lg"
                    >
                      <Printer className="w-6 h-6" />
                      IRSALIYE YAZDIR
                    </button>
                  )}
                </div>

                {/* Right: Available Packages */}
                <div className="bg-gray-50 rounded-xl border overflow-hidden">
                  <div className="p-4 border-b bg-white">
                    <h3 className="font-semibold flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      Hazir Paketler ({selectedHotelDeliveries.length})
                    </h3>
                  </div>

                  {selectedHotelDeliveries.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      <Package className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                      <p>Bu otele ait hazir paket yok</p>
                    </div>
                  ) : (
                    <div className="divide-y max-h-[500px] overflow-y-auto">
                      {selectedHotelDeliveries.map((delivery: Delivery) => {
                        const isScanned = scannedPackages.some(sp => sp.delivery.id === delivery.id);
                        return (
                          <div
                            key={delivery.id}
                            className={`p-4 cursor-pointer transition-colors ${
                              isScanned
                                ? 'bg-teal-50 border-l-4 border-teal-500'
                                : 'hover:bg-white'
                            }`}
                            onClick={() => {
                              if (!isScanned) {
                                setBarcodeInput(delivery.barcode);
                                handleScan();
                              }
                            }}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-mono font-medium">{delivery.barcode}</span>
                              {isScanned && (
                                <CheckCircle className="w-5 h-5 text-teal-600" />
                              )}
                            </div>
                            <p className="text-xs text-gray-500">
                              {delivery.deliveryItems?.length || 0} urun, {delivery.packageCount || 1} paket
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                              {formatDate(delivery.createdAt)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
