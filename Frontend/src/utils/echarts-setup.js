/**
 * ECharts 按需导入配置 — 统一注册入口
 *
 * 替代全量 `import * as echarts from 'echarts'` (~1MB)，
 * 仅注册项目实际使用的图表类型和组件。
 *
 * 使用方式：在组件中 `import echarts from '@/utils/echarts-setup'`
 */
import * as echarts from 'echarts/core'

// 图表类型
import { LineChart, BarChart, RadarChart } from 'echarts/charts'

// 组件
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  DataZoomComponent,
  MarkLineComponent,
} from 'echarts/components'

// 渲染器（同时注册 Canvas 和 SVG，按需使用）
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  BarChart,
  RadarChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
  SVGRenderer,
])

export default echarts
