import { useEffect, useState, type ComponentType } from "react";

interface Point {
  date: string;
  labor: number;
  parts: number;
}

export function SalesChart({ data }: { data: Point[] }) {
  const [Inner, setInner] = useState<ComponentType<{ data: Point[] }> | null>(null);

  useEffect(() => {
    let live = true;
    void import("./sales-chart-inner").then((mod) => {
      if (live) setInner(() => mod.SalesChartInner);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!Inner) {
    return <div className="chart-box grid place-items-center text-sm text-muted">Chart loading</div>;
  }
  return <Inner data={data} />;
}
