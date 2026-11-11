import { Tooltip } from '@shopify/polaris';
import { Glyph } from './PageHead';

/** Circled "i" that reveals help text on hover or keyboard focus. */
export function InfoTip({
  label,
  info,
  size = 20,
}: {
  label: string;
  info: string;
  size?: number;
}) {
  return (
    <Tooltip width="wide" content={info}>
      <button type="button" className="av2-info" aria-label={`About: ${label}`}>
        <Glyph size={size}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 11v5.5M12 7.7v.1" />
        </Glyph>
      </button>
    </Tooltip>
  );
}
