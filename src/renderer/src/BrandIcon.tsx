import brandIconUrl from './assets/brand-icon.png?url'

export default function BrandIcon({ className = '' }: { className?: string }): JSX.Element {
  return <img src={brandIconUrl} alt="" aria-hidden="true" draggable={false} className={`brand-icon ${className}`.trim()} />
}
