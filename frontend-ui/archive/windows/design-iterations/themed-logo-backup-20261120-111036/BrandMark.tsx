export default function BrandMark({ alt = 'Noah Vision' }: { alt?: string }) {
  return (
    <img className="brand-mark" src={import.meta.env.BASE_URL + 'branding/noah-vision-mark.png'} width={40} height={40} alt={alt} />
  )
}
