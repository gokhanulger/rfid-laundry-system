import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, QrCode, Printer, RefreshCw, CheckCircle, Package, X, Trash2, History, Search, Building2, ChevronDown, ChevronUp } from 'lucide-react';
import { deliveriesApi, settingsApi, getErrorMessage } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Delivery, DeliveryPackage } from '../types';
import { jsPDF } from 'jspdf';

interface ScannedPackage {
  delivery: Delivery;
  pkg: DeliveryPackage;
}

type TabType = 'create' | 'history';

export function IrsaliyePage() {
  const [activeTab, setActiveTab] = useState<TabType>('create');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedPackages, setScannedPackages] = useState<ScannedPackage[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
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
            <p className="text-gray-500">Paketleri tarayin ve irsaliye yazdirin</p>
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
            /* CREATE TAB */
            <div className="space-y-6">
              {/* Scanner Section */}
              <div className="bg-teal-50 rounded-xl p-6 border-2 border-teal-200">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-teal-600" />
                  Paket Barkodunu Tarayin
                </h2>

                {selectedHotel && (
                  <div className="mb-4 px-4 py-2 bg-white rounded-lg flex items-center justify-between">
                    <span className="text-teal-700">
                      <strong>Secili Otel:</strong> {selectedHotel.name}
                    </span>
                    <button
                      onClick={handleClearAll}
                      className="text-sm text-teal-600 hover:text-teal-800 underline"
                    >
                      Degistir
                    </button>
                  </div>
                )}

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

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Scanned Packages */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="bg-white rounded-xl border overflow-hidden">
                    <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                      <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Package className="w-5 h-5 text-teal-600" />
                        Taranan Paketler ({scannedPackages.length})
                      </h2>
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
                      <div className="p-12 text-center">
                        <QrCode className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                        <p className="text-xl text-gray-500">Henuz paket taranmadi</p>
                        <p className="text-gray-400 mt-2">Paket barkodlarini taramaya baslayin</p>
                      </div>
                    ) : (
                      <div className="divide-y max-h-[400px] overflow-y-auto">
                        {scannedPackages.map((sp, index) => (
                          <div key={sp.pkg.packageBarcode} className="p-4 flex items-center justify-between hover:bg-gray-50">
                            <div className="flex items-center gap-4">
                              <span className="w-8 h-8 flex items-center justify-center bg-teal-100 text-teal-700 rounded-full font-bold">
                                {index + 1}
                              </span>
                              <div>
                                <p className="font-mono font-bold">{sp.pkg.packageBarcode}</p>
                                <p className="text-sm text-gray-500">
                                  {sp.delivery.deliveryItems?.length || 0} urun
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleRemovePackage(index)}
                              className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {totals.length > 0 && (
                    <div className="bg-white rounded-xl border p-6">
                      <h3 className="text-lg font-semibold mb-4">Urun Ozeti</h3>
                      <div className="space-y-2">
                        {totals.map((item, index) => (
                          <div key={index} className="flex items-center justify-between py-2 border-b last:border-0">
                            <span className="font-medium">{item.name}</span>
                            <span className="text-xl font-bold text-teal-600">{item.count}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 pt-4 border-t flex items-center justify-between">
                        <span className="text-lg font-bold">PAKET SAYISI</span>
                        <span className="text-2xl font-bold text-teal-700">{scannedPackages.length}</span>
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

                {/* Available Packages */}
                <div className="bg-white rounded-xl border overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      Hazir Paketler
                    </h2>
                  </div>

                  {isLoading ? (
                    <div className="p-8 text-center">
                      <RefreshCw className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
                    </div>
                  ) : packagedList.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      <Package className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                      <p>Paketlenmis teslimat yok</p>
                    </div>
                  ) : (
                    <div className="divide-y max-h-[500px] overflow-y-auto">
                      {packagedList.map(delivery => (
                        <div
                          key={delivery.id}
                          className={`p-4 hover:bg-gray-50 cursor-pointer ${
                            scannedPackages.some(sp => sp.delivery.id === delivery.id)
                              ? 'bg-teal-50 border-l-4 border-teal-500'
                              : ''
                          }`}
                          onClick={() => {
                            if (!scannedPackages.some(sp => sp.delivery.id === delivery.id)) {
                              setBarcodeInput(delivery.barcode);
                              handleScan();
                            }
                          }}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono font-medium">{delivery.barcode}</span>
                            {scannedPackages.some(sp => sp.delivery.id === delivery.id) && (
                              <CheckCircle className="w-5 h-5 text-teal-600" />
                            )}
                          </div>
                          <p className="text-sm font-medium text-gray-700">{delivery.tenant?.name}</p>
                          <p className="text-xs text-gray-500">
                            {delivery.deliveryItems?.length || 0} urun, {delivery.packageCount || 1} paket
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
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

              {/* Deliveries List - Expandable */}
              {filteredDeliveries.length === 0 ? (
                <div className="p-12 text-center bg-gray-50 rounded-xl">
                  <FileText className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <p className="text-xl text-gray-500">Irsaliye bulunamadi</p>
                  <p className="text-gray-400 mt-2">Filtreleri degistirmeyi deneyin</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredDeliveries.map(delivery => {
                    const isExpanded = expandedDeliveryId === delivery.id;
                    const itemTotals = getItemTotals(delivery);

                    return (
                      <div
                        key={delivery.id}
                        className="bg-white border rounded-xl overflow-hidden"
                      >
                        {/* Header - Clickable */}
                        <div
                          className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                          onClick={() => setExpandedDeliveryId(isExpanded ? null : delivery.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="p-2 bg-teal-100 rounded-lg">
                                {isExpanded ? (
                                  <ChevronUp className="w-5 h-5 text-teal-600" />
                                ) : (
                                  <ChevronDown className="w-5 h-5 text-teal-600" />
                                )}
                              </div>
                              <div>
                                <p className="font-mono font-bold text-lg">{delivery.barcode}</p>
                                <div className="flex items-center gap-2 text-sm text-gray-500">
                                  <Building2 className="w-4 h-4" />
                                  <span>{delivery.tenant?.name}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="text-sm text-gray-500">{formatDate(delivery.labelPrintedAt || delivery.createdAt)}</p>
                                <p className="text-sm">{delivery.deliveryItems?.length || 0} urun, {delivery.packageCount || 1} paket</p>
                              </div>
                              {getStatusBadge(delivery.status)}
                            </div>
                          </div>
                        </div>

                        {/* Expanded Content */}
                        {isExpanded && (
                          <div className="border-t bg-gray-50 p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Details */}
                              <div className="space-y-3">
                                <h4 className="font-semibold text-gray-700">Detaylar</h4>
                                <div className="bg-white rounded-lg p-3 space-y-2 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Belge No:</span>
                                    <span className="font-mono font-medium">A-{delivery.barcode.slice(-9)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Tarih:</span>
                                    <span>{formatDate(delivery.labelPrintedAt || delivery.createdAt)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Paket Sayisi:</span>
                                    <span className="font-bold">{delivery.packageCount || 1}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Toplam Urun:</span>
                                    <span className="font-bold">{delivery.deliveryItems?.length || 0}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Items */}
                              <div className="space-y-3">
                                <h4 className="font-semibold text-gray-700">Urunler</h4>
                                <div className="bg-white rounded-lg p-3 space-y-2">
                                  {itemTotals.map((item, idx) => (
                                    <div key={idx} className="flex justify-between text-sm">
                                      <span>{item.name}</span>
                                      <span className="font-bold text-teal-600">{item.count}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {/* Reprint Button */}
                            <div className="mt-4 pt-4 border-t flex justify-end">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReprintIrsaliye(delivery);
                                }}
                                className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium flex items-center gap-2"
                              >
                                <Printer className="w-4 h-4" />
                                Yeniden Yazdir
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
