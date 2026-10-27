// CSPAPER 统一图表色板：低饱和、同明度区间（55–65%），与暖棕 accent 同族。
// 全部可视化（知识网络/词云/气泡/时间线/星系/热力）的唯一色源；
// 浅色用 CHART_LIGHT，深色用 CHART_DARK（各提亮一档保持对比度）。

export const CHART_LIGHT = ['#8a6d4f', '#5b7fa6', '#6f9a6e', '#c28f4e', '#8f7aa8', '#5e9aa0', '#b06e82', '#8f9a55']
export const CHART_DARK = ['#a8845f', '#7da3c9', '#8cb88a', '#d4a76a', '#ab97c4', '#7fb7bd', '#c98da0', '#adb878']

export const isDarkUI = (): boolean => document.documentElement.getAttribute('data-theme') === 'dark'

export const chart8 = (): string[] => (isDarkUI() ? CHART_DARK : CHART_LIGHT)

/** 分类名 → 稳定索引色（同分类永远同色，浅深主题自适应） */
export const catColor = (cats: string[], c: string): string => {
  const pal = chart8()
  return pal[Math.max(0, cats.indexOf(c)) % pal.length]
}
