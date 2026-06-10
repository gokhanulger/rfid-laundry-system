import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeProps {
  value: string;
  height?: number;
  width?: number;   // bar genisligi (modul)
  fontSize?: number;
  displayValue?: boolean;
  className?: string;
}

// Ekran icin CODE128 barkod (SVG). Kirli irsaliye numarasini gosterir.
export function Barcode({ value, height = 40, width = 1.6, fontSize = 12, displayValue = true, className }: BarcodeProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        height,
        width,
        fontSize,
        displayValue,
        margin: 0,
        background: 'transparent',
      });
    } catch {
      // gecersiz deger - sessizce gec
    }
  }, [value, height, width, fontSize, displayValue]);

  return <svg ref={ref} className={className} />;
}

// Kirli irsaliye numarasini barkod degerine cevir (1 -> KIRLI-000001)
export function dirtyBarcodeValue(no: number | null | undefined): string {
  const n = no ?? 0;
  return `KIRLI-${String(n).padStart(6, '0')}`;
}
