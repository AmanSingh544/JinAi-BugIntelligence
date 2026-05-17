
interface JinniLogoProps {
  size?: number;
  variant?: 'full' | 'icon';
  className?: string;
}

export function JinniLogo({ size = 40, variant = 'full', className = '' }: JinniLogoProps) {
  const scale = size / 40;
  const imgHeight = size * 1.8;

  if (variant === 'icon') {
    return (
      <img
        src="/image.png"
        alt="JinAi"
        className={className}
        style={{ height: imgHeight, width: 'auto', objectFit: 'contain', display: 'block' }}
      />
    );
  }

  // Full variant: genie icon + text wordmark side by side
  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', height: imgHeight }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        marginLeft: 6 * scale,
        position: 'relative',
      }}>
        <span style={{
          fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
          fontWeight: 800,
          fontSize: 35 * scale,
          letterSpacing: 2 * scale,
          lineHeight: 1.2,
          background: 'linear-gradient(90deg, rgb(244,114,182) 0%, rgb(192,132,252) 45%, rgb(129,140,248) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          whiteSpace: 'nowrap',
        }}>
          jinAi
        </span>
        <span style={{
          fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
          fontWeight: 800,
          fontSize: 8 * scale,
          letterSpacing: 1 * scale,
          color: 'rgb(136,146,176)',
          whiteSpace: 'nowrap',
          position: 'absolute',
          left: 10 * scale,
          bottom: -5.5 * scale,
          marginTop: 2 * scale,
        }}>
          BUG INTELLIGENCE
        </span>
      </div>
    </div>
  );
}

export default JinniLogo;
