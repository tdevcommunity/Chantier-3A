import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { adminChartColors, adminTheme } from '../../lib/admin-theme';
import { cn } from '../../lib/utils';
import type { InsightMultiBar } from '../../lib/registration-insights-aggregate';
import { INSIGHT_CHART_PALETTE } from '../../lib/registration-insights-config';

interface InsightMultiBarChartProps {
  title: string;
  subtitle?: string;
  bars: InsightMultiBar[];
  respondents: number;
}

export const InsightMultiBarChart: React.FC<InsightMultiBarChartProps> = ({
  title,
  subtitle,
  bars,
  respondents,
}) => {
  const data = useMemo(
    () =>
      bars.map((b, i) => ({
        name: b.name.length > 36 ? `${b.name.slice(0, 34)}…` : b.name,
        fullName: b.name,
        count: b.count,
        percent: b.percent,
        fill: INSIGHT_CHART_PALETTE[i % INSIGHT_CHART_PALETTE.length],
      })),
    [bars],
  );

  return (
    <div className={cn(adminTheme.card, 'flex h-full flex-col p-5')}>
      <div className="mb-4">
        <h3 className={adminTheme.cardTitle}>{title}</h3>
        <p className={adminTheme.cardSubtitle}>
          {subtitle ?? `${respondents} participant(s) avec au moins une option cochée`}
        </p>
      </div>
      {bars.length === 0 ? (
        <p className="text-xs text-zinc-500 py-8 text-center">Aucune sélection enregistrée.</p>
      ) : (
        <div className="flex-1 min-h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fontSize: 10, fill: adminChartColors.axis }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: any, _n: any, item: any) => {
                  const payload = item?.payload as { fullName?: string; percent?: number } | undefined;
                  const label = payload?.fullName ?? '';
                  const pct = payload?.percent ?? 0;
                  return [`${value} (${pct} % des répondants)`, label];
                }}
                contentStyle={{
                  backgroundColor: adminChartColors.tooltipBg,
                  color: '#fafafa',
                  borderRadius: '10px',
                  border: `1px solid ${adminChartColors.tooltipBorder}`,
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`multi-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
