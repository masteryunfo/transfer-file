"use client";

import { QRCodeCanvas } from "qrcode.react";

export default function QRCode({ value }: { value: string }) {
  return (
    <QRCodeCanvas
      value={value}
      size={160}
      bgColor="#0f172a"
      fgColor="#f8fafc"
      level="M"
      includeMargin={true}
    />
  );
}
