import type { Gender } from "@/types/catalogue";

const WOMEN = [
  ["S", "34", "28", "36"],
  ["M", "36", "30", "38"],
  ["L", "38", "32", "40"],
  ["XL", "40", "34", "42"],
  ["XXL", "42", "36", "44"],
];
const MEN = [
  ["S", "36", "30", "—"],
  ["M", "38", "32", "—"],
  ["L", "40", "34", "—"],
  ["XL", "42", "36", "—"],
  ["XXL", "44", "38", "—"],
];

/** Generic body measurements; the bust/chest column is the one most shoppers need. */
export function SizeGuide({ gender, sizes }: { gender: Gender; sizes: string[] }) {
  const standard = ["S", "M", "L", "XL", "XXL"];
  if (!sizes.some((s) => standard.includes(s.toUpperCase()))) return null;
  const men = gender === "MEN";
  const rows = men ? MEN : WOMEN;

  return (
    <details className="rounded-lg border bg-card">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">Size guide</summary>
      <div className="overflow-x-auto border-t px-4 py-3">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Body measurements in inches</caption>
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-4 font-medium">Size</th>
              <th className="py-1.5 pr-4 font-medium">{men ? "Chest" : "Bust"} (in)</th>
              <th className="py-1.5 pr-4 font-medium">Waist (in)</th>
              {!men && <th className="py-1.5 font-medium">Hip (in)</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(([size, a, b, c]) => (
              <tr key={size} className="border-t">
                <th scope="row" className="py-1.5 pr-4 font-medium">{size}</th>
                <td className="py-1.5 pr-4">{a}</td>
                <td className="py-1.5 pr-4">{b}</td>
                {!men && <td className="py-1.5">{c}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          Body measurements, not garment measurements. If you are between sizes, choose the larger one.
        </p>
      </div>
    </details>
  );
}
