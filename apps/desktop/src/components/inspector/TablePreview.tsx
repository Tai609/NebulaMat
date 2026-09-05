import { useTranslation } from "react-i18next";

// Shared tabular preview: first row of data is the header (csv and xlsx alike).
export interface TableData {
  columns: string[];
  rows: string[][];
  truncated: boolean;
}

export function TablePreview({ table }: { table: TableData }) {
  const { t } = useTranslation(["inspector", "common"]);
  return (
    <div className="p-3">
      <div className="overflow-x-auto rounded-input border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              {table.columns.map((c, i) => (
                <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="whitespace-nowrap px-3 py-1.5 font-mono text-[12.5px] text-text">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.truncated && (
        <div className="py-2 text-center text-xs text-muted">
          {t("table.showingFirstRows", { count: table.rows.length })}
        </div>
      )}
    </div>
  );
}
