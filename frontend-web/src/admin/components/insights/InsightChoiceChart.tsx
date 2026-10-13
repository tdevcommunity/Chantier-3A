import React, { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';
import { adminChartColors, adminTheme } from '../../lib/admin-theme';
import { cn } from '../../lib/utils';
import type { InsightCountSlice } from '../../lib/registration-insights-aggregate';
import {
  INSIGHT_CHART_PALETTE,
  INSIGHT_UNSET_COLOR,
  INSIGHT_UNSET_LABEL,
} from '../../lib/registration-insights-config';

interface InsightChoiceChartProps {
  title: string;
  subtitle?: string;
  slices: InsightCountSlice[];
  total: number;
}

export const InsightChoiceChart: React.FC<InsightChoiceChartProps> = ({
  title,
  subtitle,
  slices,
  total,
}) => {
  const preferDonut = slices.length <= 8 && slices.every((s) => s.name !== INSIGHT_UNSET_LABEL || slices.length <= 4);
  const [mode, setMode] = useState<'donut' | 'bar'>(preferDonut ? 'donut' : 'bar');

  const chartData = useMemo(
    () =>
      slices.map((s, i) => ({
        name: s.name,
        value: s.value,
        fill: s.name === INSIGHT_UNSET_LABEL ? INSIGHT_UNSET_COLOR : INSIGHT_CHART_PALETTE[i % INSIGHT_CHART_PALETTE.length],
      })),
    [slices],
  );

  return (
    <div className={cn(adminTheme.card, 'flex h-full flex-col p-5')}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className={adminTheme.cardTitle}>{title}</h3>
          {subtitle ? <p className={adminTheme.cardSubtitle}>{subtitle}</p> : null}
        </div>
        <div className="flex rounded-lg border border-zinc-200 p-0.5 text-[10px] font-semibold">
          <button
            type="button"
            onClick={() => setMode('donut')}
            className={cn(
              'rounded-md px-2 py-1 transition-colors',
              mode === 'donut' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800',
            )}
          >
            Donut
          </button>
          <button
            type="button"
            onClick={() => setMode('bar')}
            className={cn(
              'rounded-md px-2 py-1 transition-colors',
              mode === 'bar' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800',
            )}
          >
            Barres
          </button>
        </div>
      </div>

      {total === 0 ? (
        <p className="text-xs text-zinc-500 py-8 text-center">Aucune réponse dans cette cohorte.</p>
      ) : mode === 'donut' ? (
        <div className="flex flex-col md:flex-row items-center gap-4 flex-1">
          <div className="relative w-44 h-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  formatter={(value: any, name: any) => [
                    `${value} (${Math.round((Number(value) / total) * 100)} %)`,
                    name,
                  ]}
                  contentStyle={{
                    backgroundColor: adminChartColors.tooltipBg,
                    color: '#fafafa',
                    borderRadius: '10px',
                    border: `1px solid ${adminChartColors.tooltipBorder}`,
                    fontSize: '12px',
                  }}
                />
                <Pie data={chartData} innerRadius={52} outerRadius={72} paddingAngle={3} dataKey="value">
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold text-zinc-900">{total}</span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wide">réponses</span>
            </div>
          </div>
          <ul className="flex-1 space-y-1.5 text-xs w-full">
            {chartData.map((row) => (
              <li key={row.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.fill }} />
                  <span className="truncate text-zinc-700">{row.name}</span>
                </span>
                <span className="font-semibold text-zinc-900 shrink-0">{row.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex-1 min-h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 10, fill: adminChartColors.axis }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: any) => [`${value}`, 'Réponses']}
                contentStyle={{
                  backgroundColor: adminChartColors.tooltipBg,
                  color: '#fafafa',
                  borderRadius: '10px',
                  border: `1px solid ${adminChartColors.tooltipBorder}`,
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`bar-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
