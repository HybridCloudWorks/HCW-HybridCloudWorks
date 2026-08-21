import React from 'react';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

/**
 * Framework Radar Chart
 * Visualizes the 5-6 pillars of a framework (e.g., Well-Architected)
 * Data format: { labels: ['Security', 'Cost', ...], datasets: [{ label: 'Score', data: [5, 4, ...] }] }
 */
// `max` is the scale ceiling: 5 for the maturity model, 100 for a stored
// Well-Architected assessment (components/architecture/WafAssessment.jsx).
export default function FrameworkRadar({ data, title = 'Framework Maturity Model', max = 5 }) {
  // Default fallback data
  const chartData = data || {
    labels: [
      'Security',
      'Reliability',
      'Cost Optimization',
      'Operational Excellence',
      'Performance',
      'Sustainability',
    ],
    datasets: [
      {
        label: 'Current Maturity',
        data: [3, 4, 2, 5, 3, 1], // 1-5 scale
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 2,
        pointBackgroundColor: 'rgba(59, 130, 246, 1)',
      },
    ],
  };

  const options = {
    scales: {
      r: {
        angleLines: {
          display: true,
          color: 'rgba(128, 128, 128, 0.2)',
        },
        grid: {
          color: 'rgba(128, 128, 128, 0.2)',
        },
        suggestedMin: 0,
        suggestedMax: max,
        ticks: {
          stepSize: max / 5,
          backdropColor: 'transparent',
          display: false, // Hide numbers for cleaner look
        },
        pointLabels: {
          font: {
            size: 11,
            family: 'Inter, sans-serif',
          },
          color: 'rgba(156, 163, 175, 1)', // Tailwind gray-400
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(17, 24, 39, 0.9)',
        titleColor: '#fff',
        bodyColor: '#cbd5e1',
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
      },
    },
    maintainAspectRatio: false,
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center justify-between">
          {title}
          <span className="text-[10px] uppercase text-muted-foreground tracking-widest bg-muted px-2 py-0.5 rounded">
            Interactive
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[300px] relative">
        <Radar data={chartData} options={options} />
      </CardContent>
    </Card>
  );
}
