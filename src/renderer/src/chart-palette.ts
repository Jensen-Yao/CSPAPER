// CSPAPER 统一图表色板·水墨八色（墨/黛/竹青/赭石/朱砂/青灰/绛/灰绿）
// 浅色用宣纸上的矿物色，深色用夜墨上的亮色；与 styles.css --chart-* 同源。
export const CHART_LIGHT = ['#4a443c', '#3f5266', '#5a7256', '#96703f', '#9e4a3a', '#476b6d', '#7d5a78', '#74805e']
export const CHART_DARK = ['#b3a994', '#8ba3bd', '#96b492', '#c9a06a', '#d08272', '#86b3b5', '#b495af', '#a8b48c']

export const isDarkUI = (): boolean => document.documentElement.getAttribute('data-theme') === 'dark'

export const chart8 = (): string[] => (isDarkUI() ? CHART_DARK : CHART_LIGHT)

/** 分类名 → 稳定索引色（同分类永远同色，浅深主题自适应） */
export const catColor = (cats: string[], c: string): string => {
  const pal = chart8()
  return pal[Math.max(0, cats.indexOf(c)) % pal.length]
}
