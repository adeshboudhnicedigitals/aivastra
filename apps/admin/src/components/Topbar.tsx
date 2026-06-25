import { Fragment } from 'react';
import { Icon } from './Icons';

interface TopbarProps {
  trail: string[];
  onNavTrail: (i: number) => void;
  theme: 'light' | 'dark' | 'system';
  onToggleTheme: () => void;
}

export function Topbar({ trail, onNavTrail, theme, onToggleTheme }: TopbarProps) {
  return (
    <div className="topbar">
      <div className="crumbs">
        {trail.map((crumb, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb trail has no stable id
          <Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {i < trail.length - 1 ? (
              <button className="crumb-link" onClick={() => onNavTrail(i)}>
                {crumb}
              </button>
            ) : (
              <b>{crumb}</b>
            )}
          </Fragment>
        ))}
      </div>
      <div className="topbar-tools">
        <button
          className="iconbtn"
          onClick={onToggleTheme}
          title={`Theme: ${theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'} (click to cycle)`}
          aria-label={`Theme: ${theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'}; click to cycle`}
        >
          {theme === 'system' ? <Icon.Monitor /> : theme === 'dark' ? <Icon.Moon /> : <Icon.Sun />}
        </button>
        <div className="kbar">
          <Icon.Search />
          <span>Search jobs, users, items...</span>
          <span className="kbd">{'\u2318'}K</span>
        </div>
        <span className="status-dot">API &middot; 24ms</span>
      </div>
    </div>
  );
}
