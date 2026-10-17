"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
      <Printer aria-hidden /> Print / save as PDF
    </Button>
  );
}
