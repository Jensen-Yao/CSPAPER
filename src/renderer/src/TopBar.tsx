import * as Icon from './Icon'
import BrandIcon from './BrandIcon'

type MenuItem = { label: string; hint?: string; action?: () => void; sep?: boolean }

const SidebarIcon = (): JSX.Element => <Icon.Sidebar size={15} />
const PanelIcon = (): JSX.Element => <Icon.Panel size={15} />
const GearIcon = (): JSX.Element => <Icon.Gear size={15} />

const MenuBar = ({ menus, openMenu, setOpenMenu }: { menus: Array<{ name: string; items: MenuItem[] }>; openMenu: string | null; setOpenMenu: (m: string | null) => void }): JSX.Element => (
  <div className="app-menu">
    {menus.map((m) => (
      <div key={m.name} className="menu-wrap">
        <button
          className={`menu-btn ${openMenu === m.name ? 'on' : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setOpenMenu(openMenu === m.name ? null : m.name)}
          onMouseEnter={() => openMenu && setOpenMenu(m.name)}
        >
          {m.name}
        </button>
        {openMenu === m.name && (
          <div className="menu-dropdown" onMouseDown={(e) => e.stopPropagation()}>
            {m.items.map((it, i) =>
              it.sep ? (
                <div key={i} className="menu-sep" />
              ) : (
                <button
                  key={i}
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null)
                    it.action?.()
                  }}
                >
                  <span>{it.label}</span>
                  {it.hint && <span className="menu-hint">{it.hint}</span>}
                </button>
              )
            )}
          </div>
        )}
      </div>
    ))}
  </div>
)


interface Props {
  isMac: boolean
  menus: Array<{ name: string; items: MenuItem[] }>
  openMenu: string | null
  setOpenMenu: (m: string | null) => void
  topMode: 'work' | 'paper'
  onTopMode: (mode: 'work' | 'paper') => void
  mode: string
  showLib: boolean
  onToggleLib: () => void
  showSide: boolean
  onToggleSide: () => void
  showLibraryHome: boolean
  tabsCount: number
  focusMode: boolean
  onToggleFocus: () => void
  onOpenSettings: () => void
}

/** Window chrome: menu bar, Work / Paper switch, library and assistant panel toggles, focus mode and settings. */
export default function TopBar({ isMac, menus, openMenu, setOpenMenu, topMode, onTopMode, mode, showLib, onToggleLib, showSide, onToggleSide, showLibraryHome, tabsCount, focusMode, onToggleFocus, onOpenSettings }: Props): JSX.Element {
  return (
    <div className="titlebar">
      {!isMac && <MenuBar menus={menus} openMenu={openMenu} setOpenMenu={setOpenMenu} />}
      <div className="tb-side tb-left">
        <div className="top-switch">
          <button className={topMode === 'work' ? 'on' : ''} title="科研工作台：给目标，agent 执行" onClick={() => onTopMode('work')}>
            <Icon.Zap size={13} /> Work
          </button>
          <button className={topMode === 'paper' ? 'on' : ''} title="文献库：阅读 / 对话 / 纵览 / 笔记" onClick={() => onTopMode('paper')}>
            <Icon.Library size={13} /> Paper
          </button>
        </div>
        {topMode === 'paper' && mode === 'read' && (
          <button className={`icon-btn tb-toggle ${showLib ? 'on' : ''}`} title={showLib ? '隐藏 文献边栏' : '显示 文献边栏'} onClick={onToggleLib}>
            <SidebarIcon />
          </button>
        )}
      </div>
      <div className="tb-drag" />
      <div className="tb-title"><BrandIcon /><span className="tb-title-name">CSPAPER</span></div>
      <div className="tb-drag" />
      <div className="tb-side tb-right">
        {topMode === 'paper' && mode === 'read' && !showLibraryHome && (
          <button className={`icon-btn tb-toggle ${showSide ? 'on' : ''}`} title={showSide ? '隐藏 问答·翻译面板' : '显示 问答·翻译面板'} onClick={onToggleSide}>
            <PanelIcon />
          </button>
        )}
        {topMode === 'paper' && mode === 'read' && !showLibraryHome && tabsCount > 0 && (
          <button className="icon-btn" title="专注模式：只留正文（Esc 退出）" aria-pressed={focusMode} onClick={onToggleFocus}><Icon.Focus size={15} /></button>
        )}
        <button className="icon-btn" title="设置" onClick={onOpenSettings}>
          <GearIcon />
        </button>
      </div>
    </div>
  )
}
