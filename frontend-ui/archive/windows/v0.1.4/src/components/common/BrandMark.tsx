import { useThemePreference } from '../../services/theme'

export default function BrandMark({ alt = 'Noah Vision' }: { alt?: string }) {
  const { resolvedTheme } = useThemePreference()
  const src = import.meta.env.BASE_URL + 'branding/noah-vision-mark-' + resolvedTheme + '.png'

  return <img className="brand-mark" src={src} width={40} height={40} alt={alt} />
}
